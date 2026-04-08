"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AppIcon } from "@/components/app-icon";
import { buttonVariants } from "@/components/ui/button";
import { dashboardNavigation } from "@/lib/mollie-manager";
import { cn } from "@/lib/utils";

export function AppShellNav({
  orientation = "vertical",
}: Readonly<{
  orientation?: "horizontal" | "vertical";
}>) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className={
        orientation === "vertical"
          ? "space-y-1"
          : "app-scrollbar flex gap-2 overflow-x-auto pb-1"
      }
    >
      {dashboardNavigation.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              buttonVariants({
                size: orientation === "horizontal" ? "sm" : "default",
                variant: "ghost",
              }),
              "group justify-start gap-3 rounded-lg border border-transparent px-3 text-sm font-medium shadow-none",
              isActive
                ? "border-accent/15 bg-accent-soft text-accent-strong hover:bg-accent-soft"
                : "text-ink-soft hover:border-border/80 hover:bg-surface hover:text-ink",
              orientation === "horizontal" ? "h-9 shrink-0 bg-background" : "h-10 w-full",
            )}
          >
            <span
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-md",
                isActive
                  ? "bg-white text-accent-strong shadow-xs"
                  : "bg-surface-muted text-ink-soft",
              )}
            >
              <AppIcon name={item.icon} />
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
