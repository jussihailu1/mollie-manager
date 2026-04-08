"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function DrawerForm({
  triggerLabel,
  title,
  description,
  children,
  disabled = false,
  triggerVariant = "primary",
}: Readonly<{
  children: ReactNode;
  description?: string;
  disabled?: boolean;
  title: string;
  triggerLabel: string;
  triggerVariant?: "primary" | "secondary";
}>) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          disabled={disabled}
          variant={triggerVariant === "primary" ? "default" : "outline"}
          className="h-10 gap-2 rounded-lg px-3.5 text-sm font-medium"
        >
          <AppIcon name="plus" className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[560px]">
        <SheetHeader className="border-b border-border/80 px-5 py-4">
          <SheetTitle className="text-lg">{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="app-scrollbar flex-1 overflow-y-auto px-5 py-5">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
