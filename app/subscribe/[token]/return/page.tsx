import { getSubscriptionOnboardingReturnRecord } from "@/lib/subscription-consent";
import { StatusRefresh } from "./status-refresh";

export const dynamic = "force-dynamic";

type SubscribeReturnPageProps = {
  params: Promise<{
    token: string;
  }>;
};

function getReturnState(
  record: NonNullable<Awaited<ReturnType<typeof getSubscriptionOnboardingReturnRecord>>>,
) {
  if (record.subscriptionStatus) {
    return {
      description:
        "Your payment was received and the subscription setup is complete.",
      pending: false,
      title: "Subscription confirmed",
    };
  }

  if (
    record.firstPaymentMode === "mandate_only" &&
    record.firstPaymentStatus === "paid"
  ) {
    return {
      description:
        "The mandate setup payment completed successfully. The business will continue with the recurring subscription separately.",
      pending: false,
      title: "Mandate setup completed",
    };
  }

  if (record.firstPaymentStatus === "paid") {
    return {
      description:
        "Payment received. We are confirming your subscription now.",
      pending: true,
      title: "Payment received",
    };
  }

  return {
    description:
      "We are confirming your payment status. Please keep this page open for a moment.",
    pending: true,
    title: "Confirming payment",
  };
}

export default async function SubscribeReturnPage({
  params,
}: Readonly<SubscribeReturnPageProps>) {
  const { token } = await params;
  const record = await getSubscriptionOnboardingReturnRecord(token);

  if (!record) {
    return (
      <main className="min-h-screen bg-neutral-100 px-4 py-10 text-neutral-950 sm:px-6">
        <div className="mx-auto max-w-xl rounded-3xl border border-neutral-300 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-[-0.03em]">
            Subscription link invalid
          </h1>
          <p className="mt-4 text-sm leading-6 text-neutral-700">
            This return link is invalid or no longer available. Please contact the business for a new subscription link.
          </p>
        </div>
      </main>
    );
  }

  const state = getReturnState(record);

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-10 text-neutral-950 sm:px-6">
      <div className="mx-auto max-w-xl rounded-3xl border border-neutral-300 bg-white p-8 shadow-sm">
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-neutral-600">
          Subscription status
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em]">
          {record.businessName ?? "Subscription setup"}
        </h1>
        <div className="mt-8 rounded-2xl border border-neutral-300 bg-neutral-50 px-5 py-5">
          <p className="text-lg font-semibold tracking-[-0.03em]">{state.title}</p>
          <p className="mt-3 text-sm leading-6 text-neutral-700">{state.description}</p>
          <StatusRefresh enabled={state.pending} />
        </div>
      </div>
    </main>
  );
}
