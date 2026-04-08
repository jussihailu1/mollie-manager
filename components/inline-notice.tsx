import type { ReactNode } from "react";

import { AppIcon } from "@/components/app-icon";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const toneClasses = {
  error: "border-red-200 bg-critical-soft text-red-800",
  neutral: "border-border bg-surface-subtle text-ink-soft",
  notice: "border-accent/18 bg-accent-soft text-accent-strong",
  warning: "border-amber-200 bg-warning-soft text-amber-900",
} as const;

const toneIcons = {
  error: "alert",
  neutral: "check",
  notice: "check",
  warning: "alert",
} as const;

export function InlineNotice({
  title,
  message,
  tone = "notice",
  actions,
  className,
}: Readonly<{
  actions?: ReactNode;
  className?: string;
  message: ReactNode;
  title: string;
  tone?: keyof typeof toneClasses;
}>) {
  return (
    <Alert
      className={cn(
        "border px-4 py-3 shadow-sm lg:flex lg:items-start lg:justify-between",
        toneClasses[tone],
        className,
      )}
    >
      <div className="flex items-start gap-3 lg:max-w-[calc(100%-8rem)]">
        <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/70">
          <AppIcon name={toneIcons[tone]} className="h-4 w-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription className="leading-6">{message}</AlertDescription>
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </Alert>
  );
}
