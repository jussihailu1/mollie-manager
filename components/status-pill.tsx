import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const toneClasses = {
  accent: "border-accent/15 bg-accent-soft text-accent-strong hover:bg-accent-soft",
  critical: "border-red-200 bg-critical-soft text-red-800 hover:bg-critical-soft",
  muted: "border-border bg-surface-muted text-ink-soft hover:bg-surface-muted",
  warning: "border-amber-200 bg-warning-soft text-amber-900 hover:bg-warning-soft",
} as const;

export function StatusPill({
  children,
  tone = "accent",
}: Readonly<{
  children: ReactNode;
  tone?: keyof typeof toneClasses;
}>) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium",
        toneClasses[tone],
      )}
    >
      {children}
    </Badge>
  );
}
