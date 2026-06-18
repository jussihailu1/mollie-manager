"use client";

import { useId, useState, type ReactNode } from "react";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function DeveloperSettingsToggle({
  children,
  className,
}: Readonly<{
  children: ReactNode;
  className?: string;
}>) {
  const [enabled, setEnabled] = useState(false);
  const id = useId();

  return (
    <div className={cn("space-y-6", className)}>
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground" htmlFor={id}>
              Developer mode
            </label>
            <p className="text-sm text-muted-foreground">
              Show diagnostics, repair, replay, reconciliation, and invoice recovery controls.
            </p>
          </div>
          <Switch
            aria-label="Toggle developer mode settings"
            checked={enabled}
            id={id}
            onCheckedChange={setEnabled}
          />
        </div>
      </div>

      {enabled ? children : null}
    </div>
  );
}
