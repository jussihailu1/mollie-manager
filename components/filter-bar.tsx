import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FilterDefinition = {
  label: string;
  name: string;
  options: Array<{
    label: string;
    value: string;
  }>;
  value?: string | null;
};

export function FilterBar({
  actions,
  children,
  filters = [],
  resetHref,
  searchName = "q",
  searchPlaceholder = "Search",
  searchValue,
}: Readonly<{
  actions?: ReactNode;
  children?: ReactNode;
  filters?: FilterDefinition[];
  resetHref: string;
  searchName?: string;
  searchPlaceholder?: string;
  searchValue?: string | null;
}>) {
  return (
    <Card className="border-border/80 shadow-sm">
      <CardContent className="px-4 py-4">
        <form method="get" className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor={searchName} className="text-xs font-medium text-ink-soft">
                Search
              </Label>
              <Input
                id={searchName}
                type="search"
                name={searchName}
                defaultValue={searchValue ?? ""}
                placeholder={searchPlaceholder}
                className="bg-surface-subtle"
              />
            </div>
            {filters.map((filter) => (
              <div key={filter.name} className="flex min-w-[180px] flex-col gap-1.5">
                <Label htmlFor={filter.name} className="text-xs font-medium text-ink-soft">
                  {filter.label}
                </Label>
                <select
                  id={filter.name}
                  name={filter.name}
                  defaultValue={filter.value ?? ""}
                  className={cn(
                    "h-9 rounded-md border border-input bg-surface-subtle px-3 text-sm text-ink shadow-xs outline-none transition-[color,box-shadow]",
                    "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  )}
                >
                  {filter.options.map((option) => (
                    <option key={option.value || option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {children}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" className="h-10 rounded-lg px-3.5 text-sm font-medium">
              Apply
            </Button>
            <Button asChild variant="outline" className="h-10 rounded-lg px-3.5 text-sm font-medium">
              <Link href={resetHref}>Reset</Link>
            </Button>
            {actions}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
