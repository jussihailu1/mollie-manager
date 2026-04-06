import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { StatusPill } from "@/components/status-pill";
import { getSetupStatus } from "@/lib/env";
import { signInWithGoogle } from "@/lib/auth/actions";
import { appName } from "@/lib/mollie-manager";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const authErrorMessages: Record<string, string> = {
  AccessDenied: "This Google account is not allowed to access Mollie Manager.",
  Configuration: "Google sign-in is not configured correctly yet.",
  OAuthAccountNotLinked: "This Google account could not be linked to the current session.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();

  if (session?.user?.email) {
    redirect("/");
  }

  const resolvedSearchParams = await searchParams;
  const errorCode = Array.isArray(resolvedSearchParams.error)
    ? resolvedSearchParams.error[0]
    : resolvedSearchParams.error;
  const errorMessage = errorCode ? authErrorMessages[errorCode] ?? "Google sign-in could not be completed." : null;
  const setupStatus = getSetupStatus();

  return (
    <div className="min-h-screen bg-canvas px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl flex-col justify-center gap-5 lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:items-stretch">
        <section className="rounded-[36px] border border-ink/10 bg-panel/92 p-7 shadow-panel backdrop-blur sm:p-9">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.32em] text-ink/45">
            Owner access
          </p>
          <div className="mt-5 flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-[24px] bg-accent text-base font-semibold text-white shadow-[0_20px_50px_rgba(15,118,110,0.28)]">
              MM
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-[-0.05em] text-ink sm:text-4xl">
                {appName}
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-7 text-ink/64 sm:text-base">
                Internal control surface for first-payment setup, mandate readiness,
                and safe recurring subscription operations.
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[24px] border border-ink/8 bg-white/74 p-5">
              <StatusPill tone="accent">Google only</StatusPill>
              <p className="mt-4 text-sm leading-6 text-ink/64">
                Access is limited to the single allowlisted Google Workspace account
                configured in <span className="font-mono text-[0.8rem]">AUTH_ALLOWED_EMAIL</span>.
              </p>
            </div>
            <div className="rounded-[24px] border border-ink/8 bg-sand/64 p-5">
              <StatusPill tone={setupStatus.auth.ready ? "accent" : "warning"}>
                {setupStatus.auth.ready ? "Auth ready" : "Setup needed"}
              </StatusPill>
              <p className="mt-4 text-sm leading-6 text-ink/64">
                The sign-in flow stays disabled until the Google client, secret,
                allowed email, and auth secret are all configured.
              </p>
            </div>
          </div>

          {errorMessage ? (
            <div className="mt-6 rounded-[22px] border border-amber-500/25 bg-amber-100 px-5 py-4 text-sm leading-6 text-amber-900">
              {errorMessage}
            </div>
          ) : null}
        </section>

        <section className="rounded-[36px] border border-ink/10 bg-white/88 p-7 shadow-panel backdrop-blur sm:p-9">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-ink/45">
            Sign in
          </p>
          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.05em] text-ink">
            Continue with the owner Google account
          </h2>
          <p className="mt-3 text-sm leading-7 text-ink/64">
            This app is for internal use only. Once Google sign-in succeeds, the app
            still checks the email allowlist before granting access.
          </p>

          {setupStatus.auth.ready ? (
            <form action={signInWithGoogle} className="mt-8">
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
              >
                Continue with Google
              </button>
            </form>
          ) : (
            <div className="mt-8 rounded-[24px] border border-ink/8 bg-sand/58 p-5">
              <p className="text-sm font-semibold text-ink">Auth setup is incomplete</p>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-ink/64">
                {setupStatus.auth.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-8 rounded-[24px] border border-ink/8 bg-white/76 p-5">
            <p className="text-sm font-semibold text-ink">Required env keys</p>
            <p className="mt-3 text-sm leading-6 text-ink/64">
              <span className="font-mono text-[0.8rem]">AUTH_GOOGLE_ID</span>,
              <span className="font-mono text-[0.8rem]"> AUTH_GOOGLE_SECRET</span>,
              <span className="font-mono text-[0.8rem]"> AUTH_ALLOWED_EMAIL</span>, and
              <span className="font-mono text-[0.8rem]"> AUTH_SECRET</span>.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
