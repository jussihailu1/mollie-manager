"use client";

import { Bell, CreditCard, Search, Users } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

export function GlobalSearchDialog({
  open,
  onOpenChange,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      className="max-w-2xl"
      showCloseButton={false}
      title="Global search"
      description="Search customers, payments, and notifications."
    >
      <CommandInput placeholder="Search customers, payments, and notifications..." />
      <CommandList>
        <CommandEmpty>Search will be connected later.</CommandEmpty>
        <CommandGroup heading="Search areas">
          <CommandItem disabled value="customers">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Users className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">Customers</span>
              <span className="truncate text-xs text-muted-foreground">
                Business, contact, and email
              </span>
            </span>
            <CommandShortcut>Soon</CommandShortcut>
          </CommandItem>
          <CommandItem disabled value="payments">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CreditCard className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">Payments</span>
              <span className="truncate text-xs text-muted-foreground">
                Amount, status, and description
              </span>
            </span>
            <CommandShortcut>Soon</CommandShortcut>
          </CommandItem>
          <CommandItem disabled value="notifications">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Bell className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">Notifications</span>
              <span className="truncate text-xs text-muted-foreground">
                Alerts and operational messages
              </span>
            </span>
            <CommandShortcut>Soon</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Tip">
          <CommandItem disabled value="keyboard-shortcut">
            <Search className="size-4" />
            Press Ctrl K or Cmd K from anywhere in the dashboard
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
