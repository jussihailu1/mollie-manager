"use client";

import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { Toast } from "radix-ui";
import { useEffect, useState } from "react";

import { consumeActionFeedbackAction } from "@/lib/action-feedback";
import type { ActionFeedback } from "@/lib/action-feedback-types";
import { cn } from "@/lib/utils";

const feedbackPresentation = {
  error: {
    className: "border-destructive/40 bg-destructive text-destructive-foreground",
    icon: XCircle,
    title: "Action failed",
  },
  information: {
    className: "border-blue-500/30 bg-blue-50 text-blue-950 dark:bg-blue-950 dark:text-blue-50",
    icon: Info,
    title: "Information",
  },
  success: {
    className: "border-emerald-500/30 bg-emerald-50 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50",
    icon: CheckCircle2,
    title: "Saved",
  },
} as const;

export function ActionFeedbackToaster({
  hasPendingFeedback,
}: Readonly<{
  hasPendingFeedback: boolean;
}>) {
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  useEffect(() => {
    if (!hasPendingFeedback) {
      return;
    }

    let active = true;

    void consumeActionFeedbackAction().then((nextFeedback) => {
      if (active && nextFeedback) {
        setFeedback(nextFeedback);
      }
    });

    return () => {
      active = false;
    };
  }, [hasPendingFeedback]);

  const presentation = feedback ? feedbackPresentation[feedback.kind] : null;
  const Icon = presentation?.icon;

  return (
    <Toast.Provider duration={4_000} label="Action feedback">
      <Toast.Root
        className={cn(
          "flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-lg border p-4 shadow-lg",
          presentation?.className,
        )}
        duration={feedback?.kind === "error" ? Infinity : feedback?.kind === "information" ? 5_000 : 4_000}
        open={Boolean(feedback)}
        onOpenChange={(open) => {
          if (!open) {
            setFeedback(null);
          }
        }}
      >
        {Icon ? <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" /> : null}
        <div className="min-w-0 flex-1">
          <Toast.Title className="text-sm font-semibold">{presentation?.title}</Toast.Title>
          <Toast.Description className="mt-1 text-sm leading-5 opacity-90">
            {feedback?.message}
          </Toast.Description>
        </div>
        <Toast.Close
          aria-label="Dismiss notification"
          className="rounded-sm p-1 opacity-80 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current focus-visible:outline-none"
        >
          <X aria-hidden="true" className="size-4" />
        </Toast.Close>
      </Toast.Root>
      <Toast.Viewport className="fixed right-4 top-4 z-[100] flex max-h-screen w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 outline-none" />
    </Toast.Provider>
  );
}
