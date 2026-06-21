import "server-only";

import { sql } from "drizzle-orm";

import type { MollieMode } from "@/lib/env";
import { getDb } from "@/lib/db";

export type CustomerNotificationHistoryItem = {
  attemptCount: number;
  claimedAt: string;
  failedAt: string | null;
  id: string;
  notificationType: "failed_payment";
  occurredAt: string;
  outcomeReason: string;
  outcomeState: string;
  paymentId: string;
  sentAt: string | null;
  status: "claimed" | "failed" | "sent" | "skipped";
  templateVersion: number;
};

export async function listCustomerNotificationHistory(options: {
  customerId: string;
  limit?: number;
  mode: MollieMode;
}) {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const result = await getDb().execute<CustomerNotificationHistoryItem>(sql`
    select
      cpn.id,
      cpn.notification_type as "notificationType",
      cpn.status,
      cpn.payment_id as "paymentId",
      cpn.outcome_state as "outcomeState",
      cpn.outcome_reason as "outcomeReason",
      cpn.template_version as "templateVersion",
      cpn.attempt_count as "attemptCount",
      cpn.claimed_at as "claimedAt",
      cpn.sent_at as "sentAt",
      cpn.failed_at as "failedAt",
      coalesce(cpn.sent_at, cpn.failed_at, cpn.claimed_at) as "occurredAt"
    from customer_payment_notifications cpn
    inner join payments p
      on p.id = cpn.payment_id
      and p.mode = cpn.mode
    where cpn.mode = ${options.mode}
      and coalesce(cpn.customer_id, p.customer_id) = ${options.customerId}
    order by coalesce(cpn.sent_at, cpn.failed_at, cpn.claimed_at) desc
    limit ${limit}
  `);

  return result.rows;
}
