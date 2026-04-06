"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { dashboardNavigation } from "@/lib/mollie-manager";
import { cn } from "@/lib/utils";

export function AppShellNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="space-y-1">
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
              "group flex items-start gap-3 rounded-[20px] px-3 py-3 transition-colors duration-200",
              isActive
                ? "bg-ink text-white"
                : "text-ink/70 hover:bg-white/78 hover:text-ink",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border text-[0.72rem] font-semibold uppercase tracking-[0.22em]",
                isActive
                  ? "border-white/15 bg-white/10 text-white"
                  : "border-ink/10 bg-white/75 text-ink/55",
              )}
            >
              {item.shortLabel}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{item.label}</span>
              <span
                className={cn(
                  "mt-1 block text-sm leading-5",
                  isActive ? "text-white/72" : "text-ink/55",
                )}
              >
                {item.description}
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
