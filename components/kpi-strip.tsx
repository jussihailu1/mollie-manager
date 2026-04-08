import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const toneClasses = {
  accent: "border-accent/15 bg-accent-soft text-accent-strong hover:bg-accent-soft",
  neutral: "border-border bg-surface-muted text-ink-soft hover:bg-surface-muted",
  warning: "border-amber-200 bg-warning-soft text-amber-900 hover:bg-warning-soft",
} as const;

export function KpiStrip({
  items,
  className,
}: Readonly<{
  items: Array<{
    helper?: string;
    label: string;
    tone?: keyof typeof toneClasses;
    value: number | string;
  }>;
  className?: string;
}>) {
  return (
    <section className={cn("grid gap-3 md:grid-cols-2 xl:grid-cols-4", className)}>
      {items.map((item) => (
        <Card
          key={item.label}
          className="border-border/80 shadow-sm"
        >
          <CardContent className="flex items-end justify-between gap-3 px-4 py-4">
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-sm text-ink-soft">{item.label}</p>
              <p className="text-2xl font-semibold tracking-[-0.04em] text-ink">
                {item.value}
              </p>
            </div>
            {item.helper ? (
              <Badge
                variant="outline"
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
                  toneClasses[item.tone ?? "neutral"],
                )}
              >
                {item.helper}
              </Badge>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
