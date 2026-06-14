import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { transaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { getCustomerDetail } from "@/lib/onboarding/data";
import {
  resolveCustomerArchiveBlocker,
  resolveCustomerRestoreBlocker,
} from "@/lib/onboarding/customer-archive-policy";

type CustomerArchiveActor = {
  email?: string | null;
  kind: "user";
};

type ArchiveCustomerRecordResult =
  | {
      status: "archived";
    }
  | {
      status: "blocked";
      kind: "error" | "notice";
      message: string;
    }
  | {
      status: "not_found";
    };

type RestoreCustomerRecordResult =
  | {
      status: "restored";
    }
  | {
      status: "blocked";
      message: string;
    }
  | {
      status: "not_found";
    };

export async function archiveCustomerRecord(input: {
  actor: CustomerArchiveActor;
  customerId: string;
  mode: MollieMode;
}): Promise<ArchiveCustomerRecordResult> {
  const detail = await getCustomerDetail(input.customerId, input.mode);

  if (!detail) {
    return {
      status: "not_found",
    };
  }

  const archiveBlocker = resolveCustomerArchiveBlocker({
    archivedAt: detail.customer.archivedAt,
    subscriptions: detail.subscriptions,
  });

  if (archiveBlocker) {
    return {
      kind: archiveBlocker.kind,
      message: archiveBlocker.message,
      status: "blocked",
    };
  }

  await transaction(async (client) => {
    await client.execute(sql`
      update customers
      set archived_at = now(), updated_at = now()
      where id = ${detail.customer.id}
        and mode = ${input.mode}
        and archived_at is null
    `);

    await writeAuditLog(
      {
        action: "customer.archive",
        details: {
          localCustomerId: detail.customer.id,
          mollieCustomerId: detail.customer.mollieCustomerId,
        },
        entityId: detail.customer.id,
        entityType: "customer",
        mode: input.mode,
        outcome: "success",
        summary: "Archived local customer record.",
      },
      client,
      input.actor,
    );
  });

  return {
    status: "archived",
  };
}

export async function restoreCustomerRecord(input: {
  actor: CustomerArchiveActor;
  customerId: string;
  mode: MollieMode;
}): Promise<RestoreCustomerRecordResult> {
  const detail = await getCustomerDetail(input.customerId, input.mode);

  if (!detail) {
    return {
      status: "not_found",
    };
  }

  const restoreBlocker = resolveCustomerRestoreBlocker(detail.customer.archivedAt);

  if (restoreBlocker) {
    return {
      message: restoreBlocker.message,
      status: "blocked",
    };
  }

  await transaction(async (client) => {
    await client.execute(sql`
      update customers
      set archived_at = null, updated_at = now()
      where id = ${detail.customer.id}
        and mode = ${input.mode}
        and archived_at is not null
    `);

    await writeAuditLog(
      {
        action: "customer.restore",
        details: {
          localCustomerId: detail.customer.id,
          mollieCustomerId: detail.customer.mollieCustomerId,
        },
        entityId: detail.customer.id,
        entityType: "customer",
        mode: input.mode,
        outcome: "success",
        summary: "Restored archived local customer record.",
      },
      client,
      input.actor,
    );
  });

  return {
    status: "restored",
  };
}
