import type { ReactNode } from "react";

import { AppShellNav } from "@/components/app-shell-nav";
import { appName } from "@/lib/mollie-manager";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col px-4 py-4 lg:flex-row lg:px-6">
        <aside className="mb-4 flex w-full flex-col rounded-[28px] border border-ink/10 bg-panel/90 p-4 shadow-panel backdrop-blur lg:mb-0 lg:w-[296px] lg:p-5">
          <div className="border-b border-ink/8 pb-5">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.32em] text-ink/45">
              Internal Control
            </p>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-sm font-semibold text-white shadow-[0_20px_50px_rgba(15,118,110,0.28)]">
                MM
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-[-0.03em]">
                  {appName}
                </h1>
                <p className="text-sm text-ink/55">Phase 1 foundation</p>
              </div>
            </div>
          </div>

          <div className="pt-5">
            <AppShellNav />
          </div>

          <div className="mt-auto rounded-[22px] border border-ink/8 bg-white/72 p-4">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-ink/45">
              Safety rails
            </p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-ink/70">
              <li>Server-only Mollie writes</li>
              <li>Audit trail for money-impacting actions</li>
              <li>Webhook replay and reconciliation in later phases</li>
            </ul>
          </div>
        </aside>

        <div className="flex min-h-[calc(100vh-2rem)] flex-1 flex-col lg:pl-4">
          <header className="mb-4 flex min-h-[92px] items-center justify-between rounded-[28px] border border-ink/10 bg-white/88 px-6 py-5 shadow-panel backdrop-blur">
            <div>
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-ink/45">
                Subscription operations
              </p>
              <p className="mt-1 text-sm text-ink/65">
                Building the foundation for customer onboarding, recurring
                collection, and exception handling.
              </p>
            </div>

            <div className="rounded-full border border-accent/20 bg-accent-soft px-4 py-2 text-sm font-medium text-accent-strong">
              Guided rollout
            </div>
          </header>

          <main className="flex-1 rounded-[32px] border border-ink/10 bg-white/88 p-5 shadow-panel backdrop-blur sm:p-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
