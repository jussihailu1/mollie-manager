import {
  listEboekhoudenInvoices,
  type EboekhoudenInvoice,
} from "@/lib/eboekhouden/client";
import { filterMatchingInvoicesByReference } from "@/lib/eboekhouden/invoice-reconcile-match";

type ReconcileInput = {
  date: string;
  reference: string;
  relationId: number;
  tenantId: string;
};

type ReconcileResult =
  | {
      invoice: EboekhoudenInvoice;
      status: "found";
    }
  | {
      status: "none";
    }
  | {
      matches: EboekhoudenInvoice[];
      status: "ambiguous";
    };

export async function findExistingEboekhoudenInvoiceByReference(
  input: ReconcileInput,
): Promise<ReconcileResult> {
  const response = await listEboekhoudenInvoices({
    date: input.date,
    limit: 500,
    relationId: input.relationId,
    tenantId: input.tenantId,
  });
  const matches = filterMatchingInvoicesByReference(response.items ?? [], input);

  if (matches.length === 0) {
    return {
      status: "none",
    };
  }

  if (matches.length === 1) {
    return {
      invoice: matches[0],
      status: "found",
    };
  }

  return {
    matches,
    status: "ambiguous",
  };
}
