import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { transaction } from "@/lib/db";
import { allocateKifyInvoiceNumber } from "@/lib/invoicing/invoice-numbering";
import type { CanonicalInvoiceSnapshot } from "@/lib/invoicing/invoice-renderer";

type OwnerType = "payment" | "recurring_schedule";

export type KifyInvoiceClaim = {
  attemptNumber: number;
  snapshot: CanonicalInvoiceSnapshot;
  snapshotSha256: string;
};

function snapshotHash(snapshot: CanonicalInvoiceSnapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export async function claimKifyInvoice(input: {
  buildSnapshot(input: { invoiceId: string; invoiceNumber: string }): CanonicalInvoiceSnapshot;
  mode: "live" | "test";
  ownerId: string;
  ownerType: OwnerType;
  prefix: string;
  tenantId: string;
  year: number;
}): Promise<KifyInvoiceClaim | null> {
  return transaction(async (tx) => {
    const existing = await tx.execute<{
      canonicalSnapshot: CanonicalInvoiceSnapshot | null;
      canonicalSnapshotSha256: string | null;
      canonicalStatus: "issued" | "number_reserved" | "render_failed" | "render_pending" | "void" | null;
      id: string;
      provider: "eboekhouden" | "kify" | "mollie";
    }>(sql`
      select id, provider, canonical_status as "canonicalStatus", canonical_snapshot as "canonicalSnapshot", canonical_snapshot_sha256 as "canonicalSnapshotSha256"
      from invoices
      where tenant_id = ${input.tenantId}
        and owner_type = ${input.ownerType}::invoice_owner_type
        and owner_id = ${input.ownerId}
      limit 1
      for update
    `);
    const invoice = existing.rows[0];
    if (invoice) {
      if (invoice.provider !== "kify" || !invoice.canonicalSnapshot || !invoice.canonicalSnapshotSha256 || invoice.canonicalStatus === "issued" || invoice.canonicalStatus === "void") return null;
      const attempts = await tx.execute<{ nextAttempt: number }>(sql`
        select coalesce(max(attempt_number), 0) + 1 as "nextAttempt"
        from invoice_render_attempts
        where invoice_id = ${invoice.id} and tenant_id = ${input.tenantId}
      `);
      const attemptNumber = attempts.rows[0]?.nextAttempt ?? 1;
      await tx.execute(sql`
        insert into invoice_render_attempts (id, tenant_id, invoice_id, renderer_id, attempt_number, status, snapshot_sha256)
        values (${randomUUID()}, ${input.tenantId}, ${invoice.id}, 'native-pdfkit-v1', ${attemptNumber}, 'claimed', ${invoice.canonicalSnapshotSha256})
      `);
      await tx.execute(sql`
        update invoices set canonical_status = 'render_pending', updated_at = now()
        where id = ${invoice.id} and tenant_id = ${input.tenantId} and provider = 'kify'
      `);
      return { attemptNumber, snapshot: invoice.canonicalSnapshot, snapshotSha256: invoice.canonicalSnapshotSha256 };
    }

    const claimed = input.ownerType === "payment"
      ? await tx.execute<{ id: string }>(sql`
          update payments
          set invoice_state = 'invoice_creating', invoice_failed_at = null, updated_at = now()
          where id = ${input.ownerId} and tenant_id = ${input.tenantId} and mode = ${input.mode}
            and invoice_state in ('pending_invoice', 'invoice_failed')
          returning id
        `)
      : await tx.execute<{ id: string }>(sql`
          update recurring_billing_schedules
          set invoice_state = 'invoice_creating', invoice_failed_at = null, updated_at = now()
          where id = ${input.ownerId} and tenant_id = ${input.tenantId} and mode = ${input.mode}
            and invoice_state in ('pending_invoice', 'invoice_failed')
          returning id
        `);
    if (!claimed.rows[0]) return null;

    const invoiceId = randomUUID();
    const allocated = await allocateKifyInvoiceNumber({ client: tx, mode: input.mode, prefix: input.prefix, tenantId: input.tenantId, year: input.year });
    const snapshot = input.buildSnapshot({ invoiceId, invoiceNumber: allocated.number });
    if (snapshot.tenantId !== input.tenantId || snapshot.mode !== input.mode || snapshot.invoiceId !== invoiceId || snapshot.invoiceNumber !== allocated.number) throw new Error("Kify snapshot does not match its explicit tenant-owned claim.");
    const sha256 = snapshotHash(snapshot);
    await tx.execute(sql`
      insert into invoices (
        id, tenant_id, mode, owner_type, owner_id, provider, canonical_invoice_number,
        canonical_status, invoice_date, due_date, currency, subtotal_cents, vat_cents,
        total_cents, amount_paid_cents, balance_cents, canonical_snapshot,
        canonical_snapshot_sha256, provider_snapshot
      ) values (
        ${invoiceId}, ${input.tenantId}, ${input.mode}, ${input.ownerType}::invoice_owner_type,
        ${input.ownerId}, 'kify', ${allocated.number}, 'render_pending', ${snapshot.invoiceDate},
        ${snapshot.dueDate}, ${snapshot.currency}, ${snapshot.subtotalCents}, ${snapshot.vatCents},
        ${snapshot.totalCents}, ${snapshot.amountPaidCents}, ${snapshot.balanceCents},
        ${JSON.stringify(snapshot)}::jsonb, ${sha256}, '{}'::jsonb
      )
    `);
    for (const [index, line] of snapshot.lines.entries()) {
      await tx.execute(sql`
        insert into invoice_lines (id, tenant_id, invoice_id, position, description, quantity, unit_gross_cents, net_cents, vat_rate_basis_points, vat_cents, gross_cents)
        values (${randomUUID()}, ${input.tenantId}, ${invoiceId}, ${index + 1}, ${line.description}, ${line.quantity}, ${line.grossCents}, ${line.netCents}, ${line.vatRateBasisPoints}, ${line.vatCents}, ${line.grossCents})
      `);
    }
    await tx.execute(sql`
      insert into invoice_render_attempts (id, tenant_id, invoice_id, renderer_id, attempt_number, status, snapshot_sha256)
      values (${randomUUID()}, ${input.tenantId}, ${invoiceId}, 'native-pdfkit-v1', 1, 'claimed', ${sha256})
    `);
    return { attemptNumber: 1, snapshot, snapshotSha256: sha256 };
  });
}

export async function completeKifyInvoice(input: {
  artifactKey: string;
  artifactSha256: string;
  byteSize: number;
  invoiceId: string;
  snapshotSha256: string;
  tenantId: string;
}) {
  return transaction(async (tx) => {
    const invoiceResult = await tx.execute<{ ownerId: string; ownerType: OwnerType }>(sql`
      select owner_id as "ownerId", owner_type as "ownerType"
      from invoices
      where id = ${input.invoiceId} and tenant_id = ${input.tenantId}
        and provider = 'kify' and canonical_snapshot_sha256 = ${input.snapshotSha256}
      limit 1
      for update
    `);
    const invoice = invoiceResult.rows[0];
    if (!invoice) throw new Error("Kify invoice completion is not tenant-authorized.");
    const artifactId = randomUUID();
    await tx.execute(sql`
      insert into invoice_artifacts (id, tenant_id, invoice_id, format, renderer_id, storage_backend, private_locator, mime_type, byte_size, sha256, snapshot_sha256)
      values (${artifactId}, ${input.tenantId}, ${input.invoiceId}, 'pdf', 'native-pdfkit-v1', 'vercel_blob', ${input.artifactKey}, 'application/pdf', ${input.byteSize}, ${input.artifactSha256}, ${input.snapshotSha256})
      on conflict (invoice_id, snapshot_sha256, format)
      do update set byte_size = excluded.byte_size, sha256 = excluded.sha256
    `);
    await tx.execute(sql`
      update invoice_render_attempts
      set status = 'stored', artifact_id = (select id from invoice_artifacts where invoice_id = ${input.invoiceId} and snapshot_sha256 = ${input.snapshotSha256} and format = 'pdf'), completed_at = now(), updated_at = now()
      where id = (
        select id from invoice_render_attempts
        where invoice_id = ${input.invoiceId} and snapshot_sha256 = ${input.snapshotSha256}
        order by attempt_number desc limit 1
      )
    `);
    await tx.execute(sql`
      update invoices set canonical_status = 'issued', issued_at = coalesce(issued_at, now()), updated_at = now()
      where id = ${input.invoiceId} and tenant_id = ${input.tenantId} and provider = 'kify'
    `);
    if (invoice.ownerType === "payment") {
      await tx.execute(sql`
        update payments set invoice_state = 'invoice_created', invoice_created_at = coalesce(invoice_created_at, now()), invoice_failed_at = null, updated_at = now()
        where id = ${invoice.ownerId} and tenant_id = ${input.tenantId} and invoice_state = 'invoice_creating'
      `);
    } else {
      await tx.execute(sql`
        update recurring_billing_schedules set invoice_state = 'invoice_created', invoice_created_at = coalesce(invoice_created_at, now()), invoice_failed_at = null, updated_at = now()
        where id = ${invoice.ownerId} and tenant_id = ${input.tenantId} and invoice_state = 'invoice_creating'
      `);
    }
  });
}

export async function failKifyInvoice(input: { invoiceId: string; safeErrorCode: string; snapshotSha256: string; tenantId: string }) {
  return transaction(async (tx) => {
    const invoiceResult = await tx.execute<{ ownerId: string; ownerType: OwnerType }>(sql`
      select owner_id as "ownerId", owner_type as "ownerType" from invoices
      where id = ${input.invoiceId} and tenant_id = ${input.tenantId} and provider = 'kify'
      limit 1 for update
    `);
    const invoice = invoiceResult.rows[0];
    if (!invoice) return;
    await tx.execute(sql`
      update invoice_render_attempts set status = 'failed', safe_error_code = ${input.safeErrorCode}, completed_at = now(), updated_at = now()
      where id = (select id from invoice_render_attempts where invoice_id = ${input.invoiceId} and snapshot_sha256 = ${input.snapshotSha256} order by attempt_number desc limit 1)
    `);
    await tx.execute(sql`update invoices set canonical_status = 'render_failed', updated_at = now() where id = ${input.invoiceId} and tenant_id = ${input.tenantId} and provider = 'kify'`);
    if (invoice.ownerType === "payment") {
      await tx.execute(sql`update payments set invoice_state = 'invoice_failed', invoice_failed_at = now(), updated_at = now() where id = ${invoice.ownerId} and tenant_id = ${input.tenantId} and invoice_state = 'invoice_creating'`);
    } else {
      await tx.execute(sql`update recurring_billing_schedules set invoice_state = 'invoice_failed', invoice_failed_at = now(), updated_at = now() where id = ${invoice.ownerId} and tenant_id = ${input.tenantId} and invoice_state = 'invoice_creating'`);
    }
  });
}
