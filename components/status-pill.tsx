import { cn } from "@/lib/utils";

const toneClasses = {
  accent: "border-accent/20 bg-accent-soft text-accent-strong",
  muted: "border-ink/10 bg-white/78 text-ink/62",
  warning: "border-amber-500/25 bg-amber-100 text-amber-800",
} as const;

export function StatusPill({
  children,
  tone = "accent",
}: Readonly<{
  children: string;
  tone?: keyof typeof toneClasses;
}>) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.2em]",
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}
