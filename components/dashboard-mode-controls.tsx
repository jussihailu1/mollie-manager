"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { setSelectedMollieModeAction } from "@/lib/dashboard-mode-actions";
import type { MollieMode } from "@/lib/env";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

function getReturnTo(pathname: string, searchParams: URLSearchParams) {
  const nextSearchParams = new URLSearchParams(searchParams.toString());

  nextSearchParams.delete("mode");

  const search = nextSearchParams.toString();
  return search ? `${pathname}?${search}` : pathname;
}

async function updateSelectedMode(mode: MollieMode, returnTo: string) {
  const formData = new FormData();

  formData.set("mode", mode);
  formData.set("returnTo", returnTo);

  await setSelectedMollieModeAction(formData);
}

export function DashboardModeToggle({
  selectedMode,
  className,
}: Readonly<{
  selectedMode: MollieMode;
  className?: string;
}>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const returnTo = getReturnTo(pathname, new URLSearchParams(searchParams.toString()));

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border border-border bg-background p-1",
        className,
      )}
    >
      {(["test", "live"] as const).map((mode) => {
        const isActive = selectedMode === mode;

        return (
          <Button
            key={mode}
            type="button"
            size="sm"
            variant={isActive ? "default" : "ghost"}
            disabled={isPending || isActive}
            onClick={() => {
              startTransition(async () => {
                await updateSelectedMode(mode, returnTo);
              });
            }}
            className={cn(
              "h-8 rounded-md px-3 text-sm",
              !isActive && "text-muted-foreground",
            )}
          >
            {mode === "live" ? "Live" : "Test"}
          </Button>
        );
      })}
    </div>
  );
}

export function TestModeBanner({
  selectedMode,
  className,
}: Readonly<{
  selectedMode: MollieMode;
  className?: string;
}>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const returnTo = getReturnTo(pathname, new URLSearchParams(searchParams.toString()));

  if (selectedMode !== "test") {
    return null;
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-3 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-col gap-0.5 text-left">
        <span className="font-medium">Test mode active</span>
        <span className="text-xs text-amber-800">
          New work uses test credentials until you switch back.
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            await updateSelectedMode("live", returnTo);
          });
        }}
        className="h-8 border-amber-200 bg-white text-amber-950 hover:bg-amber-100"
      >
        Switch to live
      </Button>
    </div>
  );
}
