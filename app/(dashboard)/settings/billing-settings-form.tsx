"use client";

import { useRef, useState } from "react";

import { updateBillingSettingsAction } from "@/lib/billing-actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const selectClassName =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

function templateLabel(template: {
  active?: boolean | null;
  id: number;
  name?: string | null;
  type?: string | null;
}) {
  return [
    template.name ?? "Unnamed template",
    `#${template.id}`,
    template.type ? `type ${template.type}` : null,
    template.active === false ? "inactive" : null,
  ]
    .filter(Boolean)
    .join(" - ");
}

function ledgerLabel(ledger: {
  category?: string | null;
  code?: string | null;
  description?: string | null;
  id: number;
  name?: string | null;
}) {
  return [
    ledger.code,
    ledger.description ?? ledger.name ?? "Unnamed ledger",
    `#${ledger.id}`,
    ledger.category ? `category ${ledger.category}` : null,
  ]
    .filter(Boolean)
    .join(" - ");
}

export function BillingSettingsForm({
  invoiceTemplates,
  ledgers,
  defaultInvoiceTemplateId,
  defaultRevenueLedgerId,
  hasSavedTemplateOutsideDiscovery,
  hasSavedLedgerOutsideDiscovery,
}: {
  defaultInvoiceTemplateId: number | null | undefined;
  defaultRevenueLedgerId: number | null | undefined;
  hasSavedLedgerOutsideDiscovery: boolean;
  hasSavedTemplateOutsideDiscovery: boolean;
  invoiceTemplates: Array<{
    active?: boolean | null;
    id: number;
    name?: string | null;
    type?: string | null;
  }>;
  ledgers: Array<{
    category?: string | null;
    code?: string | null;
    description?: string | null;
    id: number;
    name?: string | null;
  }>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form className="space-y-4" action={updateBillingSettingsAction} ref={formRef}>
      <input type="hidden" name="returnTo" value="/settings" />
      <input type="hidden" name="invoiceEmailDeliveryMode" value="app_smtp" />

      <fieldset
        aria-disabled={!isEditing}
        className={!isEditing ? "pointer-events-none opacity-60" : undefined}
        disabled={!isEditing}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="invoiceTemplateId">Invoice template</Label>
            <select
              className={selectClassName}
              id="invoiceTemplateId"
              name="invoiceTemplateId"
              defaultValue={defaultInvoiceTemplateId ?? ""}
              disabled={
                !isEditing ||
                (invoiceTemplates.length === 0 && !defaultInvoiceTemplateId)
              }
            >
              <option value="">Select invoice template</option>
              {hasSavedTemplateOutsideDiscovery ? (
                <option value={defaultInvoiceTemplateId ?? ""}>
                  Saved template #{defaultInvoiceTemplateId}
                </option>
              ) : null}
              {invoiceTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {templateLabel(template)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="revenueLedgerId">Revenue ledger</Label>
            <select
              className={selectClassName}
              id="revenueLedgerId"
              name="revenueLedgerId"
              defaultValue={defaultRevenueLedgerId ?? ""}
              disabled={!isEditing || (ledgers.length === 0 && !defaultRevenueLedgerId)}
            >
              <option value="">Select revenue ledger</option>
              {hasSavedLedgerOutsideDiscovery ? (
                <option value={defaultRevenueLedgerId ?? ""}>
                  Saved ledger #{defaultRevenueLedgerId}
                </option>
              ) : null}
              {ledgers.map((ledger) => (
                <option key={ledger.id} value={ledger.id}>
                  {ledgerLabel(ledger)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      <p className="text-xs text-muted-foreground">
        Loaded {invoiceTemplates.length} invoice templates and {ledgers.length} ledger
        accounts from e-Boekhouden. VAT is fixed to 21% for now.
      </p>

      <div className="flex items-center gap-2">
        {isEditing ? (
          <>
            <Button type="submit">Save billing settings</Button>
            <Button
              type="button"
              variant="outline"
              onClick={(event) => {
                event.preventDefault();
                formRef.current?.reset();
                setIsEditing(false);
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={(event) => {
              event.preventDefault();
              setIsEditing(true);
            }}
          >
            Edit
          </Button>
        )}
      </div>
    </form>
  );
}
