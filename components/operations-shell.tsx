"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { Bell, CreditCard, Ellipsis, LayoutDashboard, Moon, Search, Sun, Users } from "lucide-react";

import { setSelectedMollieModeAction } from "@/lib/dashboard-mode-actions";
import { markAllAlertsReadAction, openAlertAction } from "@/lib/reliability/actions";
import { GlobalSearchDialog } from "@/components/global-search-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type ShellAlert = {
  createdAt: string;
  href: string;
  id: string;
  message: string;
  read: boolean;
  title: string;
};

const navigation = [
  {
    href: "/",
    icon: LayoutDashboard,
    label: "Dashboard",
    match: (pathname: string) => pathname === "/",
  },
  {
    href: "/payments",
    icon: CreditCard,
    label: "Payments",
    match: (pathname: string) => pathname.startsWith("/payments"),
  },
  {
    href: "/customers",
    icon: Users,
    label: "Customers",
    match: (pathname: string) => pathname.startsWith("/customers"),
  },
  {
    href: "/notifications",
    icon: Bell,
    label: "Notifications",
    match: (pathname: string) => pathname.startsWith("/notifications"),
  },
] as const;

function getReturnTo(pathname: string, searchParams: URLSearchParams) {
  const search = searchParams.toString();
  return search ? `${pathname}?${search}` : pathname;
}

async function updateSelectedMode(mode: "test" | "live", returnTo: string) {
  const formData = new FormData();

  formData.set("mode", mode);
  formData.set("returnTo", returnTo);

  await setSelectedMollieModeAction(formData);
}

function getBrowserTheme() {
  const storedTheme = window.localStorage.getItem("theme");

  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getServerTheme() {
  return "light" as const;
}

function subscribeToThemeChanges(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  window.addEventListener("storage", onStoreChange);
  window.addEventListener("themechange", onStoreChange);
  mediaQuery.addEventListener("change", onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("themechange", onStoreChange);
    mediaQuery.removeEventListener("change", onStoreChange);
  };
}

function setStoredTheme(theme: "light" | "dark") {
  window.localStorage.setItem("theme", theme);
  window.dispatchEvent(new Event("themechange"));
}

export function OperationsShell({
  children,
  recentAlerts,
  selectedMode,
}: Readonly<{
  children: ReactNode;
  recentAlerts: ShellAlert[];
  selectedMode: "test" | "live";
}>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const theme = useSyncExternalStore(
    subscribeToThemeChanges,
    getBrowserTheme,
    getServerTheme,
  );
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isModePending, startModeTransition] = useTransition();
  const unreadCount = recentAlerts.filter((alert) => !alert.read).length;
  const returnTo = getReturnTo(pathname, new URLSearchParams(searchParams.toString()));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setIsSearchOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="w-64 border-r bg-card min-h-screen flex flex-col">
        <div className="flex items-center justify-between p-6">
          <h1 className="text-2xl font-bold tracking-tighter text-primary">Kify</h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground">
                <Ellipsis className="h-4 w-4" />
                <span className="sr-only">Open environment menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Environment</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="flex items-center justify-between gap-3 px-2 py-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="text-sm font-medium">
                    {selectedMode === "live" ? "Live mode" : "Test mode"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {selectedMode === "live" ? "Real Mollie data" : "Sandbox Mollie data"}
                  </p>
                </div>
                <Switch
                  aria-label="Toggle Mollie live mode"
                  checked={selectedMode === "live"}
                  disabled={isModePending}
                  size="sm"
                  onCheckedChange={(checked) => {
                    startModeTransition(async () => {
                      await updateSelectedMode(checked ? "live" : "test", returnTo);
                    });
                  }}
                />
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          {navigation.map((item) => {
            const isActive = item.match(pathname);

            return (
              <Button
                key={item.href}
                asChild
                variant={isActive ? "secondary" : "ghost"}
                className={cn("w-full justify-start", item.href === "/notifications" && "relative")}
              >
                <Link href={item.href}>
                  <item.icon className="mr-2 h-4 w-4" />
                  {item.label}
                  {item.href === "/notifications" && unreadCount > 0 ? (
                    <span className="absolute right-3 h-2.5 w-2.5 rounded-full bg-red-600" />
                  ) : null}
                </Link>
              </Button>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b bg-card flex items-center justify-between px-8 shrink-0 relative z-50">
          <div className="flex flex-1 items-center">
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full max-w-[280px] justify-start gap-2 bg-muted/50 px-3 text-sm text-muted-foreground hover:bg-muted/80"
              onClick={() => setIsSearchOpen(true)}
            >
              <Search className="size-4" />
              <span>Search...</span>
              <kbd className="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
                <span className="text-xs">⌘</span>K
              </kbd>
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setStoredTheme(theme === "light" ? "dark" : "light")}
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            >
              {theme === "light" ? (
                <Moon className="size-5 text-muted-foreground" />
              ) : (
                <Sun className="size-5 text-muted-foreground" />
              )}
              <span className="sr-only">
                {theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
              </span>
            </Button>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative">
                  <Bell className="h-5 w-5 text-muted-foreground" />
                  {unreadCount > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 h-4 w-4 rounded-full bg-red-600" />
                  ) : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0 z-50" sideOffset={8}>
                <div className="flex items-center justify-between p-4 border-b">
                  <h4 className="font-semibold text-sm">Notifications</h4>
                  {unreadCount > 0 ? (
                    <form action={markAllAlertsReadAction}>
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <Button variant="ghost" size="sm" className="h-auto p-0 text-xs text-muted-foreground">
                        Mark all as read
                      </Button>
                    </form>
                  ) : null}
                </div>
                <ScrollArea className="h-[300px]">
                  {recentAlerts.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      No notifications
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {recentAlerts.map((alert) => (
                        <form key={alert.id} action={openAlertAction}>
                          <input type="hidden" name="alertId" value={alert.id} />
                          <input type="hidden" name="redirectTo" value={alert.href} />
                          <button
                            type="submit"
                            className={cn(
                              "flex w-full items-start gap-3 border-b p-4 text-left transition-colors hover:bg-accent last:border-b-0",
                              !alert.read && "bg-accent/50",
                            )}
                          >
                            <div className="mt-0.5 shrink-0">
                              <span className="block h-2 w-2 rounded-full bg-red-600" />
                            </div>
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium leading-none">{alert.title}</p>
                                {!alert.read ? (
                                  <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                                ) : null}
                              </div>
                              <p className="text-xs text-muted-foreground line-clamp-2">
                                {alert.message}
                              </p>
                              <p className="text-[10px] text-muted-foreground/80">
                                {formatDateTime(alert.createdAt)}
                              </p>
                            </div>
                          </button>
                        </form>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </PopoverContent>
            </Popover>
          </div>

          <GlobalSearchDialog open={isSearchOpen} onOpenChange={setIsSearchOpen} />
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
