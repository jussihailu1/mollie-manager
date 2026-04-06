import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Panel({
  eyebrow,
  title,
  description,
  children,
  className,
}: Readonly<{
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}>) {
  return (
    <section
      className={cn(
        "rounded-[28px] border border-ink/8 bg-panel/78 p-5 shadow-panel sm:p-6",
        className,
      )}
    >
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-ink/45">
        {eyebrow}
      </p>
      <h2 className="mt-3 max-w-2xl text-[1.9rem] font-semibold leading-tight tracking-[-0.05em] text-ink">
        {title}
      </h2>
      {description ? (
        <p className="mt-3 max-w-3xl text-sm leading-6 text-ink/62">
          {description}
        </p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}
