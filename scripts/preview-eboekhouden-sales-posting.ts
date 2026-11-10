#!/usr/bin/env node
// Deliberately no --apply path and no app workflow imports. The only HTTP POST
// creates a short-lived authentication session; every accounting request is GET.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import process from "node:process";
import pg from "pg";
import { decryptTenantCredential } from "../lib/tenant-credential-encryption";
import { readAllEboekhoudenPages } from "../lib/eboekhouden/pagination";
import { previewSalesPosting, type LocalPostingInvoice } from "../lib/eboekhouden/sales-posting-preview";
import { parseInvoiceDateReviews } from "../lib/eboekhouden/sales-posting-date-review";
import type { EboekhoudenInvoice, EboekhoudenLedger } from "../lib/eboekhouden/client";
import type { SalesMutation } from "../lib/eboekhouden/invoice-posting";

function argumentsForPreview() {
  const args = process.argv.slice(2);
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!["--tenant-id", "--mode", "--env-file", "--output", "--reviewed-dates"].includes(key) || !args[index + 1] || args[index + 1].startsWith("--") || values[key]) {
      throw new Error("Usage: --tenant-id ID --mode live|test [--env-file PATH] [--output PRIVATE_PATH] [--reviewed-dates PRIVATE_PATH]. Preview only; --apply is not supported.");
    }
    values[key] = args[index + 1];
  }
  if (!values["--tenant-id"] || !["live", "test"].includes(values["--mode"])) throw new Error("An explicit tenant and mode are required.");
  return values;
}

async function main() {
  const args = argumentsForPreview();
  if (args["--env-file"]) process.loadEnvFile(args["--env-file"]);
  const tenantId = args["--tenant-id"];
  const mode = args["--mode"];
  const reviewBytes = args["--reviewed-dates"] ? await readFile(args["--reviewed-dates"]) : null;
  const dateManifest = reviewBytes ? parseInvoiceDateReviews(JSON.parse(reviewBytes.toString("utf8")), { tenantId, mode }) : null;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, options: "-c default_transaction_read_only=on" });
  await client.connect();
  let localInvoices: LocalPostingInvoice[];
  let settings: Record<string, unknown>;
  let credential: { api_source: string; api_token_ciphertext: string };
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const readOnly = await client.query("SHOW transaction_read_only");
    if (readOnly.rows[0]?.transaction_read_only !== "on") throw new Error("Database did not enforce read-only mode.");
    const credentials = await client.query("select api_source, api_token_ciphertext from tenant_eboekhouden_credentials where tenant_id = $1", [tenantId]);
    if (credentials.rows.length !== 1) throw new Error("Tenant credentials are missing or ambiguous.");
    credential = credentials.rows[0];
    const billing = await client.query(`select b.active_invoice_provider, b.tax_treatment, e.revenue_ledger_id, e.invoice_template_id
      from tenant_billing_settings b left join tenant_eboekhouden_invoice_settings e on e.tenant_id = b.tenant_id where b.tenant_id = $1`, [tenantId]);
    settings = billing.rows[0] ?? {};
    const invoices = await client.query(`select i.id as "localInvoiceId", i.provider_invoice_id as "providerInvoiceId",
      i.provider_invoice_number as "invoiceNumber",
      coalesce(i.provider_snapshot->>'relationId', i.provider_customer_id, cal.provider_customer_id)::int as "relationId",
      coalesce(i.provider_snapshot->>'reference', case when i.owner_type = 'payment'
        then 'FP-' || left(i.owner_id, 8) || '-' || to_char((coalesce(p.paid_at, p.created_at) at time zone 'UTC')::date, 'YYMMDD')
        else 'RB-' || left(i.owner_id, 8) || '-' || to_char(r.planned_collection_date, 'YYMMDD') end) as reference,
      coalesce(i.provider_snapshot->>'date', case when i.owner_type = 'payment'
        then to_char(coalesce(p.paid_at, p.created_at) at time zone 'UTC', 'YYYY-MM-DD') else r.invoice_send_due_date::text end) as "invoiceDate",
      coalesce(p.amount_value, r.amount_value)::text as "amountValue", coalesce(p.amount_currency, r.amount_currency)::text as currency
      from invoices i
      left join payments p on i.owner_type = 'payment' and p.id = i.owner_id and p.tenant_id = i.tenant_id and p.mode = i.mode
      left join recurring_billing_schedules r on i.owner_type = 'recurring_schedule' and r.id = i.owner_id and r.tenant_id = i.tenant_id and r.mode = i.mode
      left join subscriptions s on s.id = r.subscription_id and s.tenant_id = i.tenant_id and s.mode = i.mode
      left join customer_accounting_links cal on cal.customer_id = coalesce(p.customer_id, s.customer_id) and cal.tenant_id = i.tenant_id and cal.mode = i.mode and cal.provider = 'eboekhouden'
      where i.tenant_id = $1 and i.mode = $2 and i.provider = 'eboekhouden' order by i.provider_invoice_number`, [tenantId, mode]);
    localInvoices = invoices.rows;
    if (dateManifest?.reviews.some(review => localInvoices.filter(local => local.localInvoiceId === review.localInvoiceId).length !== 1)) {
      throw new Error("Reviewed-date manifest contains an absent or ambiguous local invoice.");
    }
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
  const apiToken = decryptTenantCredential(credential.api_token_ciphertext, {
    createError: message => new Error(message), currentSecret: process.env.APP_ENCRYPTION_KEY,
    currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.", invalidMessage: "Invalid tenant credentials.",
    legacySecret: process.env.AUTH_SECRET, legacySecretMissingMessage: "Legacy decryption key is missing.",
    scope: "mollie-manager:tenant-eboekhouden-credentials:",
  });
  const apiBase = "https://api.e-boekhouden.nl";
  const sessionResponse = await fetch(`${apiBase}/v1/session`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken: apiToken, source: credential.api_source }),
    signal: AbortSignal.timeout(30000), redirect: "error",
  });
  if (!sessionResponse.ok) throw new Error(`e-Boekhouden authentication failed (${sessionResponse.status}).`);
  const session = await sessionResponse.json() as { token: string };
  if (!session.token) throw new Error("No e-Boekhouden session token returned.");
  let accountingGetCount = 0;
  async function get<T>(path: string): Promise<T> {
    if (!/^\/v1\/(invoice|mutation|ledger)(\/|\?|$)/.test(path)) throw new Error("Path outside the read-only accounting allowlist.");
    accountingGetCount++;
    const response = await fetch(`${apiBase}${path}`, {
      method: "GET", headers: { Authorization: session.token }, signal: AbortSignal.timeout(30000), redirect: "error",
    });
    if (!response.ok) throw new Error(`e-Boekhouden read failed (${response.status}) at ${path.split("?")[0]}. No report was marked complete.`);
    return response.json() as Promise<T>;
  }
  const listAll = <T extends { id: number }>(path: string) => readAllEboekhoudenPages<T>((limit, offset) => get(`${path}${path.includes("?") ? "&" : "?"}limit=${limit}&offset=${offset}`));
  // Full administration scan, including paid/manual entries and credit documents.
  const ledgers = await listAll<EboekhoudenLedger>("/v1/ledger");
  const mutationIndex = await listAll<SalesMutation>("/v1/mutation");
  const mutations: SalesMutation[] = [];
  for (const item of mutationIndex) {
    const detail = await get<SalesMutation>(`/v1/mutation/${item.id}`);
    if (detail.id !== item.id) throw new Error("Mutation identity changed during the scan.");
    mutations.push(detail);
  }
  const invoiceIndex = await listAll<EboekhoudenInvoice & { id: number }>("/v1/invoice");
  const documents: EboekhoudenInvoice[] = [];
  for (const item of invoiceIndex) {
    const detail = await get<EboekhoudenInvoice>(`/v1/invoice/${item.id}`);
    if (detail.id !== item.id) throw new Error("Invoice identity changed during the scan.");
    const { urlPdfFile: _privateUrl, ...document } = detail;
    void _privateUrl;
    documents.push(document);
  }
  type Outstanding = { mutationId: number; invoiceNumber?: string; relationId?: number; totalAmount?: number; paidAmount?: number; outstandingAmount?: number };
  const outstanding = await readAllEboekhoudenPages(async (limit, offset) => {
    const page = await get<{ items: Outstanding[] }>(`/v1/mutation/invoice/outstanding?credDeb=D&limit=${limit}&offset=${offset}`);
    if (!Array.isArray(page.items)) throw new Error("Outstanding list is incomplete.");
    return { items: page.items.map(item => ({ ...item, id: item.mutationId })) };
  });
  const previews = localInvoices.map(local => previewSalesPosting({
    local, invoice: documents.find(document => document.id === Number(local.providerInvoiceId)) ?? {},
    mutations, ledgers, outstanding, otherInvoices: documents,
    dateReview: dateManifest?.reviews.find(review => review.localInvoiceId === local.localInvoiceId),
  }));
  const report = {
    checkedAt: new Date().toISOString(), tenantId, mode,
    readOnly: { database: true, accountingGetCount, financialWrites: 0, authenticationSessionsCreated: 1 },
    scope: "Complete available invoice/mutation lists, all detail GETs; current local invoice owners only. No application/replay/delivery mode.",
    caveat: "Provider reads are not an atomic snapshot. No candidate is authorization to post. Recheck all matches and closed periods before a later repair; arbitrary unreferenced aggregate corrections may still require bookkeeper review.",
    settings,
    reviewedDates: dateManifest && reviewBytes ? { manifestSha256: createHash("sha256").update(reviewBytes).digest("hex"), ...dateManifest } : null,
    counts: { localInvoices: localInvoices.length, providerInvoices: documents.length, mutations: mutations.length, ledgers: ledgers.length, outstanding: outstanding.length },
    summary: {
      withoutSalesEntryNumber: previews.filter(item => !mutations.some(mutation => String(mutation.type) === "2" && mutation.invoiceNumber === item.invoiceNumber)).length,
      missing: previews.filter(item => item.status === "missing_sales_posting").length,
      alreadyPosted: previews.filter(item => item.status === "already_posted").length,
      reviewRequired: previews.filter(item => item.status === "review_required").length,
      acceptedDateReviews: previews.filter(item => item.acceptedDateReview).length,
      missingAmount: previews.filter(item => item.status === "missing_sales_posting").reduce((sum, item) => sum + Math.round(item.amount! * 100), 0) / 100,
    },
    ledgers: ledgers.filter(ledger => ledger.category === "DEB" || ledger.id === settings.revenue_ledger_id),
    mutationYears: mutations.reduce<Record<string, number>>((counts, mutation) => {
      const year = mutation.date?.slice(0, 4) ?? "unknown";
      counts[year] = (counts[year] ?? 0) + 1;
      return counts;
    }, {}),
    previews,
  };
  if (args["--output"]) {
    const output = resolve(args["--output"]);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ output, counts: report.counts, summary: report.summary, previews: previews.map(({ proposedMutation: _payload, ...entry }) => { void _payload; return entry; }) }, null, 2));
  } else console.log(JSON.stringify(report, null, 2));
}

void main().catch(error => {
  // Never print provider response bodies, connection strings or credential objects.
  console.error(error instanceof Error ? error.message : "Read-only preview failed.");
  process.exitCode = 1;
});
