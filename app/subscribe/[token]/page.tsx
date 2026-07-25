import Link from "next/link";

import { acceptSubscriptionConsentAction, getSubscriptionConsentByToken } from "@/lib/subscription-consent";
import { formatCurrency, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const errorMessages: Record<string, string> = {
  checkout_missing:
    "This consent link is missing a checkout destination. Please ask support for a new link.",
  consent_form_invalid: "The consent form input was invalid. Please try again.",
  consent_not_found: "This consent link is invalid or expired. Request a new link.",
  consent_required: "Please accept the required consent checkboxes to continue.",
};

type SubscribePageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getSingleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatInterval(interval: "weekly" | "monthly" | "yearly") {
  if (interval === "weekly") {
    return "Weekly";
  }

  if (interval === "monthly") {
    return "Monthly";
  }

  return "Yearly";
}

export default async function SubscribeConsentPage({
  params,
  searchParams,
}: Readonly<SubscribePageProps>) {
  const { token } = await params;
  const resolvedSearchParams = await searchParams;
  const consent = await getSubscriptionConsentByToken(token);
  const errorCode = getSingleParam(resolvedSearchParams.error);
  const errorMessage = errorCode ? errorMessages[errorCode] : null;

  if (!consent) {
    return (
      <main className="min-h-screen bg-neutral-100 px-4 py-10 text-neutral-950 sm:px-6">
        <div className="mx-auto max-w-2xl rounded-3xl border border-neutral-300 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-[-0.03em]">Subscription consent link invalid</h1>
          <p className="mt-4 text-sm leading-6 text-ink/70">
            This link is invalid or no longer available. Please ask the business for a new consent link.
          </p>
        </div>
      </main>
    );
  }

  const plan = consent.planSnapshot;
  const usesLegacyAcknowledgments = consent.requiredCheckboxKeys.some(
    (key) => key !== "subscription_terms_ack",
  );

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-10 text-neutral-950 sm:px-6">
      <div className="mx-auto max-w-2xl rounded-3xl border border-neutral-300 bg-white p-8 shadow-sm">
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-neutral-600">
          Subscription consent
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em]">
          {consent.businessName ?? "Subscription setup"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-neutral-700">
          Confirm the subscription summary before continuing to payment.
        </p>

        {errorMessage ? (
          <div className="mt-6 rounded-xl border border-amber-500/25 bg-amber-100 px-4 py-3 text-sm text-amber-900">
            {errorMessage}
          </div>
        ) : null}

        <section className="mt-8 space-y-3 rounded-2xl border border-neutral-300 bg-white p-5 text-sm">
          <div className="flex items-start justify-between gap-4">
            <span className="text-neutral-700">Subscription</span>
            <span className="text-right font-medium">
              {formatCurrency(plan.subscriptionAmountValue, plan.amountCurrency)}{" "}
              {formatInterval(plan.billingInterval).toLowerCase()}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <span className="text-neutral-700">Term</span>
            <span className="text-right font-medium">
              {plan.subscriptionTermMode === "fixed_term"
                ? `${plan.totalPayments ?? "-"} payments`
                : "Until cancelled"}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <span className="text-neutral-700">First payment</span>
            <span className="text-right font-medium">
              {formatCurrency(plan.firstPaymentAmountValue, plan.amountCurrency)}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <span className="text-neutral-700">Cancel by email</span>
            <a className="text-right font-medium underline" href={`mailto:${plan.cancellationEmail}`}>
              {plan.cancellationEmail}
            </a>
          </div>
          <div className="flex items-start justify-between gap-4">
            <span className="text-neutral-700">Terms & privacy</span>
            <span className="text-right font-medium">
              <Link className="underline" href={plan.termsPrivacy.termsUrl} target="_blank">
                Terms
              </Link>
              {" · "}
              <Link className="underline" href={plan.termsPrivacy.privacyUrl} target="_blank">
                Privacy
              </Link>
              {` (${plan.termsPrivacy.termsVersion})`}
            </span>
          </div>
          <details className="border-t border-neutral-200 pt-3 text-neutral-700">
            <summary className="cursor-pointer font-medium text-neutral-950">Payment details</summary>
            <div className="mt-3 space-y-3 leading-6">
              {plan.finalChargeDate ? <p>Final charge: {formatDate(plan.finalChargeDate)}.</p> : null}
              <p>
                {plan.serviceEndAt
                  ? `Service remains active until ${formatDate(plan.serviceEndAt)}.`
                  : plan.cancellationEffect === "end_of_paid_period"
                    ? "Service remains active until the end of the paid period."
                    : "Service ends immediately when cancelled."}
              </p>
              <p>
                We email the invoice {plan.recurringBilling.invoiceNoticeDaysBeforeDueDate} calendar days before automatic collection. A direct debit can fail or be reversed; the payment obligation may remain open.
              </p>
              {plan.firstPaymentMode === "mandate_only" ? (
                <p>The EUR 0.01 setup payment is separate from the subscription and is not an installment.</p>
              ) : null}
            </div>
          </details>
        </section>

        {consent.acceptedAt ? (
          <div className="mt-8 rounded-2xl border border-emerald-500/20 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
            <p className="font-medium">Consent already recorded</p>
            <p className="mt-2">Accepted on {formatDate(consent.acceptedAt)}.</p>
            {consent.checkoutUrl ? (
              <a
                className="mt-4 inline-flex rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white"
                href={consent.checkoutUrl}
              >
                Continue to payment
              </a>
            ) : null}
          </div>
        ) : (
          <form className="mt-8 space-y-5" action={acceptSubscriptionConsentAction}>
            <input type="hidden" name="token" value={consent.consentToken} />

            {usesLegacyAcknowledgments ? (
              <>
                <label className="flex items-start gap-3 rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm leading-6">
                  <input className="mt-1 h-4 w-4" type="checkbox" name="recurringTermsAck" value="yes" required />
                  <span>I understand that this starts a recurring subscription under the terms shown above.</span>
                </label>
                <label className="flex items-start gap-3 rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm leading-6">
                  <input className="mt-1 h-4 w-4" type="checkbox" name="recurringBillingPolicyAck" value="yes" required />
                  <span>I agree to the recurring billing details shown above.</span>
                </label>
                <label className="flex items-start gap-3 rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm leading-6">
                  <input className="mt-1 h-4 w-4" type="checkbox" name="cancellationPolicyAck" value="yes" required />
                  <span>I understand cancellation is handled by email.</span>
                </label>
              </>
            ) : (
              <label className="flex items-start gap-3 rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm leading-6">
                <input className="mt-1 h-4 w-4" type="checkbox" name="subscriptionTermsAck" value="yes" required />
                <span>I agree to this subscription summary, the Terms, and the Privacy Policy.</span>
              </label>
            )}

            <button
              type="submit"
              className="inline-flex rounded-full border border-neutral-900 bg-neutral-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
            >
              Accept and continue to payment
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

