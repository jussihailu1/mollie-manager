import { sql } from "drizzle-orm";

import type { MollieMode } from "@/lib/env";

export type FirstPaymentInvoiceMatchInput = {
  mode?: MollieMode;
  paymentId?: string;
};

export function buildFirstPaymentFilter(input?: FirstPaymentInvoiceMatchInput) {
  const filters = [sql`p.payment_type = 'first'`, sql`p.mollie_payment_id is not null`];

  if (input?.mode) {
    filters.push(sql`p.mode = ${input.mode}`);
  }

  if (input?.paymentId) {
    filters.push(sql`p.id = ${input.paymentId}`);
  }

  return sql.join(filters, sql` and `);
}

export function buildDeterministicMatchCte(input?: FirstPaymentInvoiceMatchInput) {
  const filters = buildFirstPaymentFilter(input);

  return sql`
    with payment_link_matches as (
      select
        p.id as payment_id,
        pl.id as payment_link_id,
        soc.id as consent_id,
        soc.accepted_at as consent_accepted_at,
        soc.first_payment_mode as first_payment_mode,
        soc.plan_snapshot as plan_snapshot
      from payments p
      inner join payment_links pl
        on pl.mode = p.mode
        and pl.metadata ->> 'source' = 'subscription_onboarding'
        and pl.metadata ->> 'paymentType' = 'first'
        and (
          pl.metadata ->> 'latestPaymentId' = p.mollie_payment_id
          or coalesce(pl.metadata -> 'paymentIds', '[]'::jsonb) ? p.mollie_payment_id
        )
      inner join subscription_onboarding_consents soc
        on soc.mode = p.mode
        and soc.payment_link_id = pl.id
      where ${filters}
    ),
    matched_ranked as (
      select
        payment_id,
        payment_link_id,
        consent_id,
        consent_accepted_at,
        first_payment_mode,
        plan_snapshot,
        count(*) over (partition by payment_id) as match_count
      from payment_link_matches
    ),
    deterministic_matches as (
      select
        payment_id,
        payment_link_id,
        consent_id,
        consent_accepted_at,
        first_payment_mode,
        plan_snapshot
      from matched_ranked
      where match_count = 1
    )
  `;
}
