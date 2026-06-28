import "server-only";

import { MandateStatus, PaymentMethod } from "@mollie/api-client";
import { sql } from "drizzle-orm";

import { writeAuditLog } from "@/lib/audit";
import { getDb, transaction } from "@/lib/db";
import type { MollieMode } from "@/lib/env";
import { getMollieClient, getMollieWebhookUrl } from "@/lib/mollie/client";
import { upsertRecurringBillingScheduleForSubscription } from "@/lib/recurring-billing-schedule";
import { deliverAlertEmail, openAlert, resolveAlertsForEntity } from "@/lib/reliability/alerts";
import { subscriptionConsentPlanSnapshotSchema } from "@/lib/subscription-consent";
import { toMollieInterval } from "@/lib/subscription-policy";
import { mapSubscriptionLifecycle } from "@/lib/subscriptions";
import { requireCustomerTenantId } from "@/lib/tenant-ownership";

type ActivationActor =
  | {
      email?: string | null;
      kind: "system";
    }
  | {
      email?: string | null;
      kind: "user";
    };

type ActivationTrigger = "auto" | "manual";

type ActivationCustomer = {
  archivedAt: string | null;
  id: string;
  mollieCustomerId: string | null;
};

type ActivationConsent = {
  acceptedAt: string;
  consentId: string;
  firstPaymentMode: "real_installment" | "mandate_only";
  paymentLinkId: string;
  planSnapshot: unknown;
};

type ActivationPayment = {
  id: string;
  mollieStatus: string | null;
  paidAt: string | null;
};

type ActivationMandate = {
  id: string;
  method: string | null;
  mollieMandateId: string;
  mollieStatus: string | null;
};

type ActivationSubscription = {
  consentId: string | null;
  id: string;
  localStatus: string;
};

type PendingReason =
  | "archived"
  | "customer_not_linked"
  | "missing_consent"
  | "missing_mandate"
  | "missing_paid_first_payment";

type AlreadyExistsReason = "blocking_subscription" | "consent_already_used";

export type SubscriptionActivationResult =
  | {
      firstPaymentMode: "real_installment" | "mandate_only";
      mollieSubscriptionId: string;
      status: "created";
      subscriptionId: string;
    }
  | {
      firstPaymentMode: "real_installment" | "mandate_only";
      reason: AlreadyExistsReason;
      status: "already_exists";
      subscriptionId: string;
    }
  | {
      firstPaymentMode: "real_installment" | "mandate_only" | null;
      reason: PendingReason;
      status: "pending_prerequisites";
    }
  | {
      firstPaymentMode: "mandate_only";
      reason: "manual_only";
      status: "skipped";
    }
  | {
      firstPaymentMode: "real_installment" | "mandate_only" | null;
      message: string;
      status: "failed";
    };

function serializeActivationError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 180);
  }

  return "Subscription activation failed.";
}

function findPreferredDirectDebitMandate(mandates: ActivationMandate[]) {
  return mandates.find(
    (mandate) =>
      (mandate.method === PaymentMethod.directdebit ||
        mandate.method === "directdebit") &&
      (mandate.mollieStatus === MandateStatus.valid ||
        mandate.mollieStatus === MandateStatus.pending),
  );
}

async function getActivationContext(customerId: string, mode: MollieMode) {
  const [customerResult, consentResult, paymentResult, mandateResult, subscriptionResult] =
    await Promise.all([
      getDb().execute<ActivationCustomer>(sql`
        select
          id,
          mollie_customer_id as "mollieCustomerId",
          archived_at as "archivedAt"
        from customers
        where id = ${customerId}
          and mode = ${mode}
        limit 1
      `),
      getDb().execute<ActivationConsent>(sql`
        select
          soc.id as "consentId",
          soc.payment_link_id as "paymentLinkId",
          soc.first_payment_mode as "firstPaymentMode",
          soc.plan_snapshot as "planSnapshot",
          soc.accepted_at as "acceptedAt"
        from subscription_onboarding_consents soc
        where soc.customer_id = ${customerId}
          and soc.mode = ${mode}
          and soc.accepted_at is not null
        order by soc.accepted_at desc
        limit 1
      `),
      getDb().execute<ActivationPayment>(sql`
        select
          id,
          mollie_status as "mollieStatus",
          paid_at as "paidAt"
        from payments
        where customer_id = ${customerId}
          and mode = ${mode}
          and payment_type = 'first'
        order by created_at desc
      `),
      getDb().execute<ActivationMandate>(sql`
        select
          id,
          mollie_mandate_id as "mollieMandateId",
          method,
          mollie_status as "mollieStatus"
        from mandates
        where customer_id = ${customerId}
          and mode = ${mode}
        order by created_at desc
      `),
      getDb().execute<ActivationSubscription>(sql`
        select
          id,
          local_status as "localStatus",
          metadata ->> 'consentId' as "consentId"
        from subscriptions
        where customer_id = ${customerId}
          and mode = ${mode}
        order by created_at desc
      `),
    ]);

  return {
    consents: consentResult.rows,
    customer: customerResult.rows[0] ?? null,
    mandates: mandateResult.rows,
    payments: paymentResult.rows,
    subscriptions: subscriptionResult.rows,
  };
}

export async function attemptSubscriptionActivation(input: {
  actor?: ActivationActor;
  customerId: string;
  mode: MollieMode;
  trigger: ActivationTrigger;
}): Promise<SubscriptionActivationResult> {
  const context = await getActivationContext(input.customerId, input.mode);
  const customer = context.customer;

  if (!customer) {
    return {
      firstPaymentMode: null,
      reason: "customer_not_linked",
      status: "pending_prerequisites",
    };
  }

  if (customer.archivedAt) {
    return {
      firstPaymentMode: null,
      reason: "archived",
      status: "pending_prerequisites",
    };
  }

  if (!customer.mollieCustomerId) {
    return {
      firstPaymentMode: null,
      reason: "customer_not_linked",
      status: "pending_prerequisites",
    };
  }

  const acceptedConsent = context.consents[0] ?? null;

  if (!acceptedConsent) {
    return {
      firstPaymentMode: null,
      reason: "missing_consent",
      status: "pending_prerequisites",
    };
  }

  if (
    input.trigger === "auto" &&
    acceptedConsent.firstPaymentMode === "mandate_only"
  ) {
    return {
      firstPaymentMode: acceptedConsent.firstPaymentMode,
      reason: "manual_only",
      status: "skipped",
    };
  }

  const parsedPlan = subscriptionConsentPlanSnapshotSchema.safeParse(
    acceptedConsent.planSnapshot,
  );

  if (!parsedPlan.success) {
    const message =
      "Accepted consent snapshot is invalid. Create a new first payment link.";

    return {
      firstPaymentMode: acceptedConsent.firstPaymentMode,
      message,
      status: "failed",
    };
  }

  const latestPaidFirstPayment = context.payments.find(
    (payment) => payment.mollieStatus === "paid" && payment.paidAt,
  );

  if (!latestPaidFirstPayment) {
    return {
      firstPaymentMode: acceptedConsent.firstPaymentMode,
      reason: "missing_paid_first_payment",
      status: "pending_prerequisites",
    };
  }

  const preferredMandate = findPreferredDirectDebitMandate(context.mandates);

  if (!preferredMandate) {
    return {
      firstPaymentMode: acceptedConsent.firstPaymentMode,
      reason: "missing_mandate",
      status: "pending_prerequisites",
    };
  }

  const consentLinkedSubscription = context.subscriptions.find(
    (subscription) => subscription.consentId === acceptedConsent.consentId,
  );

  if (consentLinkedSubscription) {
    await resolveAlertsForEntity({
      paymentId: latestPaidFirstPayment.id,
    });

    return {
      firstPaymentMode: acceptedConsent.firstPaymentMode,
      reason: "consent_already_used",
      status: "already_exists",
      subscriptionId: consentLinkedSubscription.id,
    };
  }

  const blockingSubscription = context.subscriptions.find((subscription) =>
    subscription.localStatus === "active" ||
    subscription.localStatus === "mandate_pending" ||
    subscription.localStatus === "draft",
  );

  if (blockingSubscription) {
    return {
      firstPaymentMode: acceptedConsent.firstPaymentMode,
      reason: "blocking_subscription",
      status: "already_exists",
      subscriptionId: blockingSubscription.id,
    };
  }

  const plan = parsedPlan.data;
  const localSubscriptionId = crypto.randomUUID();
  const tenantId = await requireCustomerTenantId(customer.id);

  try {
    const subscription = await getMollieClient(input.mode).customerSubscriptions.create({
      amount: {
        currency: "EUR",
        value: plan.subscriptionAmountValue,
      },
      customerId: customer.mollieCustomerId,
      description: plan.description,
      idempotencyKey: `subscription-onboarding:${input.mode}:${acceptedConsent.consentId}`,
      interval: toMollieInterval(plan.billingInterval),
      mandateId: preferredMandate.mollieMandateId,
      metadata: {
        consentId: acceptedConsent.consentId,
        customerId: customer.id,
        firstPaymentMode: acceptedConsent.firstPaymentMode,
        localSubscriptionId,
        trigger: input.trigger,
      },
      startDate: plan.startDate,
      ...(plan.subscriptionTermMode === "fixed_term" &&
      plan.recurringChargeCount !== null
        ? {
            times: plan.recurringChargeCount,
          }
        : {}),
      webhookUrl: getMollieWebhookUrl(),
    });

    await transaction(async (client) => {
      await client.execute(sql`
        insert into subscriptions (
          id,
          tenant_id,
          customer_id,
          mandate_id,
          mode,
          mollie_subscription_id,
          local_status,
          mollie_status,
          description,
          interval,
          amount_value,
          amount_currency,
          subscription_term_mode,
          total_payments,
          last_charge_date,
          service_end_at,
          cancellation_effect,
          billing_day,
          start_date,
          stop_after_current_period,
          metadata,
          created_at,
          updated_at,
          last_synced_at
        ) values (
          ${localSubscriptionId},
          ${tenantId},
          ${customer.id},
          ${preferredMandate.id},
          ${input.mode},
          ${subscription.id},
          ${mapSubscriptionLifecycle(subscription.status)},
          ${subscription.status},
          ${subscription.description},
          ${subscription.interval},
          ${subscription.amount.value},
          ${subscription.amount.currency},
          ${plan.subscriptionTermMode},
          ${plan.totalPayments},
          ${plan.finalChargeDate}::date,
          ${plan.serviceEndAt}::timestamptz,
          ${plan.cancellationEffect},
          ${new Date(`${plan.startDate}T00:00:00Z`).getUTCDate()},
          ${subscription.startDate}::date,
          ${false},
          ${JSON.stringify({
            consentId: acceptedConsent.consentId,
            firstPaymentMode: acceptedConsent.firstPaymentMode,
            nextPaymentDate: subscription.nextPaymentDate ?? null,
            trigger: input.trigger,
          })}::jsonb,
          now(),
          now(),
          now()
        )
      `);

      await writeAuditLog(
        {
          action:
            input.trigger === "auto"
              ? "subscription.auto_activate"
              : "subscription.create",
          details: {
            consentId: acceptedConsent.consentId,
            localSubscriptionId,
            mollieSubscriptionId: subscription.id,
            startDate: subscription.startDate,
            trigger: input.trigger,
          },
          entityId: localSubscriptionId,
          entityType: "subscription",
          mode: input.mode,
          outcome: "success",
          summary:
            input.trigger === "auto"
              ? "Activated a subscription from an accepted consent and paid first payment."
              : "Created a subscription from accepted consent and a verified first payment.",
        },
        client,
        input.actor,
      );

      await upsertRecurringBillingScheduleForSubscription(client, {
        actor: input.actor,
        amountCurrency: subscription.amount.currency,
        amountValue: subscription.amount.value,
        firstPaymentMode: acceptedConsent.firstPaymentMode,
        interval: subscription.interval,
        mode: input.mode,
        nextPaymentDate: subscription.nextPaymentDate ?? null,
        startDate: subscription.startDate ?? plan.startDate,
        subscriptionId: localSubscriptionId,
        subscriptionTermMode: plan.subscriptionTermMode,
        totalPayments: plan.totalPayments,
      });
    });

    await resolveAlertsForEntity({
      paymentId: latestPaidFirstPayment.id,
    });

    return {
      firstPaymentMode: acceptedConsent.firstPaymentMode,
      mollieSubscriptionId: subscription.id,
      status: "created",
      subscriptionId: localSubscriptionId,
    };
  } catch (error) {
    const message = serializeActivationError(error);

    await writeAuditLog(
      {
        action:
          input.trigger === "auto"
            ? "subscription.auto_activate"
            : "subscription.create",
        details: {
          consentId: acceptedConsent.consentId,
          paymentId: latestPaidFirstPayment.id,
          trigger: input.trigger,
        },
        entityId: customer.id,
        entityType: "customer",
        mode: input.mode,
        outcome: "failure",
        summary: "Subscription activation failed after payment confirmation.",
      },
      undefined,
      input.actor,
    );

    const alert = await openAlert({
      customerId: customer.id,
      message:
        "A paid onboarding flow could not be promoted into a subscription. Review the customer and retry activation after checking Mollie.",
      paymentId: latestPaidFirstPayment.id,
      payload: {
        consentId: acceptedConsent.consentId,
        error: message,
        trigger: input.trigger,
      },
      severity: "warning",
      title: "Subscription activation failed",
    });

    if (alert.isNew) {
      await deliverAlertEmail({
        alertId: alert.id,
        message:
          "A paid onboarding flow could not be promoted into a subscription. Open Mollie Manager to inspect the customer and retry activation.",
        tenantId,
        title: "Subscription activation failed",
      });
    }

    return {
      firstPaymentMode: acceptedConsent.firstPaymentMode,
      message,
      status: "failed",
    };
  }
}
