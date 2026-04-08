"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const variantClasses = {
  danger: "border-red-200 bg-critical-soft text-red-800 hover:bg-red-100",
  primary: "",
  secondary: "",
} as const;

const buttonVariants = {
  danger: "destructive",
  primary: "default",
  secondary: "outline",
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
    <Button
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
      variant={buttonVariants[variant]}
      className={cn(
        "h-10 rounded-lg px-3.5 text-sm font-medium",
        variantClasses[variant],
        className,
      )}
    >
      {pending ? pendingLabel ?? "Working..." : children}
    </Button>
  );
}
