"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import {
  Bell,
  CreditCard,
  Ellipsis,
  ExternalLink,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Users,
} from "lucide-react";

import { setSelectedMollieModeAction } from "@/lib/dashboard-mode-actions";
import { signOutUser } from "@/lib/auth/actions";
import { markAllAlertsReadAction, openAlertAction } from "@/lib/reliability/actions";
import { GlobalSearchDialog } from "@/components/global-search-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { getRouteRefreshIntervalMs } from "@/lib/freshness";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const mollieDashboardHref = "https://my.mollie.com/dashboard/org_19456510/home";

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
    href: "/customers",
    icon: Users,
    label: "Customers",
    match: (pathname: string) => pathname.startsWith("/customers"),
  },
  {
    href: "/payments",
    icon: CreditCard,
    label: "Payments",
    match: (pathname: string) => pathname.startsWith("/payments"),
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

function getBrowserSidebarCollapsed() {
  return window.localStorage.getItem("sidebar-collapsed") === "true";
}

function getServerSidebarCollapsed() {
  return false;
}

function subscribeToSidebarChanges(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("sidebarcollapsechange", onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("sidebarcollapsechange", onStoreChange);
  };
}

function setStoredSidebarCollapsed(collapsed: boolean) {
  window.localStorage.setItem("sidebar-collapsed", String(collapsed));
  window.dispatchEvent(new Event("sidebarcollapsechange"));
}

function getUserInitials(userName: string | null, userEmail: string) {
  const source = userName?.trim() || userEmail.trim();
  const parts = source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2);

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "U";
}

export function OperationsShell({
  children,
  isLiveModeDisabled = false,
  recentAlerts,
  selectedMode,
  userEmail,
  userName,
}: Readonly<{
  children: ReactNode;
  isLiveModeDisabled?: boolean;
  recentAlerts: ShellAlert[];
  selectedMode: "test" | "live";
  userEmail: string;
  userName: string | null;
}>) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const theme = useSyncExternalStore(
    subscribeToThemeChanges,
    getBrowserTheme,
    getServerTheme,
  );
  const isSidebarCollapsed = useSyncExternalStore(
    subscribeToSidebarChanges,
    getBrowserSidebarCollapsed,
    getServerSidebarCollapsed,
  );
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [isSidebarMenuOpen, setIsSidebarMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isRefreshPending, startRefreshTransition] = useTransition();
  const [isModePending, startModeTransition] = useTransition();
  const [isLogoutPending, startLogoutTransition] = useTransition();
  const lastRefreshAtRef = useRef(0);
  const unreadCount = recentAlerts.filter((alert) => !alert.read).length;
  const returnTo = getReturnTo(pathname, new URLSearchParams(searchParams.toString()));
  const isTestMode = selectedMode === "test";
  const userInitials = getUserInitials(userName, userEmail);
  const isSidebarVisuallyCollapsed = isSidebarCollapsed && !isSidebarHovered && !isSidebarMenuOpen;
  const shouldShowSidebarMenu = !isSidebarVisuallyCollapsed;

  useEffect(() => {
    lastRefreshAtRef.current = Date.now();
  }, [pathname]);

  const refreshCurrentView = useCallback(
    (force = false) => {
      const now = Date.now();
      const cooldownMs = 10_000;

      if (!force && now - lastRefreshAtRef.current < cooldownMs) {
        return;
      }

      lastRefreshAtRef.current = now;
      startRefreshTransition(() => {
        router.refresh();
      });
    },
    [router, startRefreshTransition],
  );

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

  useEffect(() => {
    const intervalMs = getRouteRefreshIntervalMs(pathname);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshCurrentView(false);
      }
    };
    const handleFocus = () => {
      if (document.visibilityState === "visible") {
        refreshCurrentView(false);
      }
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        refreshCurrentView(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);

    const intervalId =
      intervalMs !== null
        ? window.setInterval(() => {
            if (document.visibilityState === "visible") {
              refreshCurrentView(false);
            }
          }, intervalMs)
        : null;

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [pathname, refreshCurrentView]);

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        onMouseEnter={() => setIsSidebarHovered(true)}
        onMouseLeave={() => setIsSidebarHovered(false)}
        className={cn(
          "min-h-screen shrink-0 overflow-hidden border-r bg-card flex flex-col transition-all duration-200",
          isSidebarVisuallyCollapsed ? "w-16" : "w-64",
        )}
      >
        <div
          className={cn(
            "flex items-center p-6",
            isSidebarVisuallyCollapsed ? "flex-col justify-center gap-3 px-0" : "justify-between",
          )}
        >
          <h1 className="text-2xl font-bold tracking-tighter text-primary">
            {isSidebarVisuallyCollapsed ? "K" : "Kify"}
          </h1>
          {shouldShowSidebarMenu ? (
            <DropdownMenu open={isSidebarMenuOpen} onOpenChange={setIsSidebarMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground">
                  <Ellipsis className="h-4 w-4" />
                  <span className="sr-only">Open environment menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-80 p-2">
                <div className="flex items-center gap-3 px-2 py-2.5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-muted text-sm font-medium text-muted-foreground">
                    {userInitials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-none text-foreground">
                      {userName ?? userEmail}
                    </p>
                    <p className="truncate pt-1 text-sm text-muted-foreground">
                      {userEmail}
                    </p>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <Link href="/settings">
                      <Settings data-icon="inline-start" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <div className="flex items-center gap-3 rounded-sm px-2 py-2 text-sm">
                    <FlaskConical className="size-4 text-muted-foreground" />
                    <span className="flex-1 font-medium text-foreground">Test mode</span>
                    <Switch
                      aria-label="Toggle test mode"
                      checked={isTestMode}
                      disabled={isModePending || isLiveModeDisabled}
                      size="sm"
                      onCheckedChange={(checked) => {
                        if (!checked && isLiveModeDisabled) {
                          return;
                        }

                        startModeTransition(async () => {
                          await updateSelectedMode(checked ? "test" : "live", returnTo);
                        });
                      }}
                    />
                  </div>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <a
                      href={mollieDashboardHref}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <ExternalLink data-icon="inline-start" />
                      Open Mollie
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    disabled={isLogoutPending}
                    variant="destructive"
                    onSelect={(event) => {
                      event.preventDefault();
                      startLogoutTransition(async () => {
                        await signOutUser();
                      });
                    }}
                  >
                    <LogOut data-icon="inline-start" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <nav className={cn("flex-1 space-y-2", isSidebarVisuallyCollapsed ? "px-2" : "px-4")}>
          {navigation.map((item) => {
            const isActive = item.match(pathname);

            return (
              <Button
                key={item.href}
                asChild
                variant={isActive ? "secondary" : "ghost"}
                className={cn(
                  "w-full",
                  isSidebarVisuallyCollapsed ? "justify-center px-0" : "justify-start",
                  item.href === "/notifications" && "relative",
                )}
                title={isSidebarVisuallyCollapsed ? item.label : undefined}
              >
                <Link href={item.href}>
                  <item.icon className={cn(isSidebarVisuallyCollapsed ? "h-5 w-5" : "mr-2 h-4 w-4")} />
                  <span className={cn(isSidebarVisuallyCollapsed && "sr-only")}>{item.label}</span>
                  {item.href === "/notifications" && unreadCount > 0 ? (
                    <span
                      className={cn(
                        "absolute rounded-full bg-red-600",
                        isSidebarVisuallyCollapsed
                          ? "right-1.5 top-1.5 h-2.5 w-2.5 border-2 border-card"
                          : "right-3 h-2.5 w-2.5",
                      )}
                    />
                  ) : null}
                </Link>
              </Button>
            );
          })}
        </nav>

        <div className="border-t p-4">
          <Button
            type="button"
            variant="ghost"
            size="default"
            className={cn("w-full", isSidebarVisuallyCollapsed ? "justify-center" : "justify-start px-2")}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setStoredSidebarCollapsed(!isSidebarCollapsed)}
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="size-5 text-muted-foreground" />
            ) : (
              <PanelLeftClose className={cn("size-4 text-muted-foreground", !isSidebarVisuallyCollapsed && "mr-2")} />
            )}
            <span className="sr-only">
              {isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            </span>
          </Button>
        </div>
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
              onClick={() => refreshCurrentView(true)}
              title="Refresh current view"
              disabled={isRefreshPending}
            >
              <RefreshCw className={cn("size-4 text-muted-foreground", isRefreshPending && "animate-spin")} />
              <span className="sr-only">Refresh current view</span>
            </Button>

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
