import { Check, CircleAlert, Clock3 } from "lucide-react";

import { getSubscriptionOnboardingReturnRecord } from "@/lib/subscription-consent";
import { getSubscriptionReturnState } from "@/lib/subscription-return-state";

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
      <main className="flex min-h-[100svh] items-center justify-center bg-neutral-100 px-4 py-8 text-neutral-950 sm:px-6 sm:py-12">
        <div className="w-full max-w-[32rem] rounded-[1.75rem] border border-neutral-300 bg-white px-6 py-10 text-center shadow-sm sm:px-12 sm:py-14">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-neutral-950 text-white">
            <CircleAlert aria-hidden="true" className="size-5" strokeWidth={1.8} />
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">
            Subscription link invalid
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-neutral-600 sm:text-base">
            This return link is invalid or no longer available. Please contact the business for a new subscription link.
          </p>
        </div>
      </main>
    );
  }

  const state = getSubscriptionReturnState(record);
  const isIssue = state.tone === "issue";
  const isPending = state.tone === "pending";

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-neutral-100 px-4 py-8 text-neutral-950 sm:px-6 sm:py-12">
      <div className="w-full max-w-[32rem] rounded-[1.75rem] border border-neutral-300 bg-white px-6 py-10 text-center shadow-sm sm:px-12 sm:py-14">
        <div
          className={
            isIssue
              ? "mx-auto flex size-12 items-center justify-center rounded-full bg-red-50 text-red-700"
              : "mx-auto flex size-12 items-center justify-center rounded-full bg-neutral-950 text-white"
          }
        >
          {isIssue ? (
            <CircleAlert aria-hidden="true" className="size-5" strokeWidth={1.8} />
          ) : isPending ? (
            <Clock3 aria-hidden="true" className="size-5" strokeWidth={1.8} />
          ) : (
            <Check aria-hidden="true" className="size-6" strokeWidth={2.25} />
          )}
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">
          {state.title}
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-neutral-600 sm:text-base">
          {state.description}
        </p>
        <p className="mx-auto mt-5 max-w-sm text-sm leading-6 text-neutral-500 sm:text-base">
          {state.nextStep}
        </p>
      </div>
    </main>
  );
}
