import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function EntityListRow({
  title,
  description,
  meta,
  badges,
  actions,
  className,
}: Readonly<{
  actions?: ReactNode;
  badges?: ReactNode;
  className?: string;
  description?: ReactNode;
  meta?: ReactNode;
  title: ReactNode;
}>) {
  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-[16px] border border-border bg-surface px-4 py-3 shadow-panel lg:flex-row lg:items-start lg:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {badges}
        </div>
        {description ? (
          <div className="mt-1 text-sm leading-6 text-ink-soft">{description}</div>
        ) : null}
        {meta ? <div className="mt-2 text-xs text-ink-soft">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </article>
  );
}
