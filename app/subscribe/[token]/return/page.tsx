import { getSubscriptionOnboardingReturnRecord } from "@/lib/subscription-consent";
import { getSubscriptionReturnState } from "@/lib/subscription-return-state";
import { StatusRefresh } from "./status-refresh";

export const dynamic = "force-dynamic";

type SubscribeReturnPageProps = {
  params: Promise<{
    token: string;
  }>;
};

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

  const state = getSubscriptionReturnState(record);
  const panelClassName =
    state.tone === "issue"
      ? "mt-8 rounded-2xl border border-red-200 bg-red-50 px-5 py-5"
      : "mt-8 rounded-2xl border border-neutral-300 bg-neutral-50 px-5 py-5";

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-10 text-neutral-950 sm:px-6">
      <div className="mx-auto max-w-xl rounded-3xl border border-neutral-300 bg-white p-8 shadow-sm">
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-neutral-600">
          Subscription status
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em]">
          {record.businessName ?? "Subscription setup"}
        </h1>
        <div className={panelClassName}>
          <p className="text-lg font-semibold tracking-[-0.03em]">{state.title}</p>
          <p className="mt-3 text-sm leading-6 text-neutral-700">{state.description}</p>
          <p className="mt-3 text-sm leading-6 text-neutral-700">{state.nextStep}</p>
          <StatusRefresh enabled={state.pending} />
        </div>
      </div>
    </main>
  );
}
