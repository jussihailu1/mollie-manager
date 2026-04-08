import type { ReactNode } from "react";

import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type DataColumn = {
  align?: "left" | "right";
  className?: string;
  label: string;
};

export function DataTable({
  columns,
  children,
  className,
}: Readonly<{
  columns: DataColumn[];
  children: ReactNode;
  className?: string;
}>) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/80 bg-surface shadow-sm",
        className,
      )}
    >
      <Table className="min-w-full text-left">
        <TableHeader className="bg-surface-subtle">
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableHead
                key={column.label}
                className={cn(
                  "h-11 px-4 text-xs font-medium text-ink-soft",
                  column.align === "right" ? "text-right" : "text-left",
                  column.className,
                )}
              >
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="[&_td]:px-4 [&_td]:py-4">{children}</TableBody>
      </Table>
    </div>
  );
}
