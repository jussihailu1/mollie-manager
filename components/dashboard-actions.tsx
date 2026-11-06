"use client";

import { useState } from "react";
import { Link2, Plus } from "lucide-react";

import {
  CreateCustomerDialog,
  CreatePaymentLinkDialog,
  type CustomerFlowRecord,
} from "@/components/customer-flow-dialogs";
import { Button } from "@/components/ui/button";

export function DashboardActions({
  customers,
  hasEboekhoudenConnection,
}: Readonly<{
  customers: CustomerFlowRecord[];
  hasEboekhoudenConnection: boolean;
}>) {
  const [dialog, setDialog] = useState<"customer" | "payment" | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => setDialog("payment")}>
          <Link2 className="h-4 w-4" /> Create payment link
        </Button>
        <Button onClick={() => setDialog("customer")}>
          <Plus className="h-4 w-4" /> Add customer
        </Button>
      </div>
      <CreateCustomerDialog
        hasEboekhoudenConnection={hasEboekhoudenConnection}
        open={dialog === "customer"}
        onOpenChange={(open) => setDialog(open ? "customer" : null)}
      />
      <CreatePaymentLinkDialog
        customer={null}
        customers={customers}
        open={dialog === "payment"}
        onOpenChange={(open) => setDialog(open ? "payment" : null)}
      />
    </>
  );
}
