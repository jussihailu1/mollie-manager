"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { cn } from "@/lib/utils";

const variantClasses = {
  primary:
    "bg-ink text-white hover:bg-ink/88 disabled:bg-ink/35 disabled:text-white/80",
  secondary:
    "border border-ink/10 bg-white text-ink/80 hover:bg-sand/55 disabled:text-ink/45",
} as const;

export function FormActionButton({
  children,
  className,
  confirmMessage,
  disabled = false,
  pendingLabel,
  type = "submit",
  variant = "primary",
}: Readonly<{
  children: ReactNode;
  className?: string;
  confirmMessage?: string;
  disabled?: boolean;
  pendingLabel?: string;
  type?: "button" | "submit";
  variant?: keyof typeof variantClasses;
}>) {
  const { pending } = useFormStatus();
  const buttonIsDisabled = pending || disabled;

  return (
    <button
      type={type}
      disabled={buttonIsDisabled}
      onClick={(event) => {
        if (buttonIsDisabled || !confirmMessage) {
          return;
        }

        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition-colors",
        variantClasses[variant],
        className,
      )}
    >
      {pending ? pendingLabel ?? "Working..." : children}
    </button>
  );
}
