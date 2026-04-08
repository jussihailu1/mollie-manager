import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";

export function EmptyState({
  title,
  description,
  action,
}: Readonly<{
  action?: ReactNode;
  description: string;
  title: string;
}>) {
  return (
    <Card className="border-dashed border-border-strong bg-surface-subtle shadow-none">
      <CardContent className="flex flex-col gap-3 px-5 py-7 text-sm leading-6 text-ink-soft">
        <p className="text-base font-semibold text-ink">{title}</p>
        <p className="max-w-2xl">{description}</p>
        {action ? <div>{action}</div> : null}
      </CardContent>
    </Card>
  );
}
