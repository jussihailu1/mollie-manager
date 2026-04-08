import type { ReactNode } from "react";
import { ExternalLink, LogOut } from "lucide-react";

import { AppShellNav } from "@/components/app-shell-nav";
import { DashboardModeToggle, TestModeBanner } from "@/components/dashboard-mode-controls";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutUser } from "@/lib/auth/actions";
import { requireViewerSession } from "@/lib/auth/session";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { appName } from "@/lib/mollie-manager";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const session = await requireViewerSession();
  const selectedMode = await getSelectedMollieMode();

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="flex min-h-screen w-full">
        <aside className="hidden w-64 shrink-0 border-r border-border/80 bg-surface/90 lg:flex lg:flex-col">
          <div className="border-b border-border/80 px-4 py-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-12 w-full justify-start gap-3 rounded-lg px-3 text-left shadow-none hover:bg-surface-muted"
                >
                  <span className="inline-flex size-9 items-center justify-center rounded-lg bg-ink text-sm font-semibold text-white">
                    MM
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold text-ink">
                      {appName}
                    </span>
                    <span className="truncate text-xs text-ink-soft">
                      Operator workspace
                    </span>
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {session.user.email}
                    </p>
                    <p className="text-xs text-ink-soft">
                      Default mode: {selectedMode}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <a
                      href="https://my.mollie.com/dashboard/org_19456510"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink />
                      Open Mollie dashboard
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild variant="destructive">
                  <button type="submit" form="dashboard-signout" className="w-full">
                    <LogOut />
                    Sign out
                  </button>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <form id="dashboard-signout" action={signOutUser} />
          </div>

          <div className="px-3 py-4">
            <AppShellNav />
          </div>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-border/80 bg-canvas/95 backdrop-blur">
            <div className="flex items-center justify-between gap-3 px-4 py-3 lg:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="h-10 gap-3 rounded-lg px-2 shadow-none">
                    <span className="inline-flex size-8 items-center justify-center rounded-lg bg-ink text-xs font-semibold text-white">
                      MM
                    </span>
                    <span className="text-sm font-semibold">{appName}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col gap-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {session.user.email}
                      </p>
                      <p className="text-xs text-ink-soft">
                        Default mode: {selectedMode}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem asChild>
                      <a
                        href="https://my.mollie.com/dashboard/org_19456510"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink />
                        Open Mollie dashboard
                      </a>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild variant="destructive">
                    <button
                      type="submit"
                      form="dashboard-signout-mobile"
                      className="w-full"
                    >
                      <LogOut />
                      Sign out
                    </button>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DashboardModeToggle selectedMode={selectedMode} />
              <form id="dashboard-signout-mobile" action={signOutUser} />
            </div>
            {selectedMode === "test" ? (
              <div className="flex justify-center px-4 py-3">
                <TestModeBanner selectedMode={selectedMode} />
              </div>
            ) : null}
            <div className="border-t border-border/80 px-4 py-2 lg:hidden">
              <AppShellNav orientation="horizontal" />
            </div>
          </header>

          <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
