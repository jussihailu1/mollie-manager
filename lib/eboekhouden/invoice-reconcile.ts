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
  const pageSize = 500;
  const maxPages = 20;
  const matches: EboekhoudenInvoice[] = [];
  let complete = false;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await listEboekhoudenInvoices({
      date: input.date,
      limit: pageSize,
      offset: page * pageSize,
      relationId: input.relationId,
      tenantId: input.tenantId,
    });
    const items = response.items ?? [];
    matches.push(...filterMatchingInvoicesByReference(items, input));
    if (items.length < pageSize || (typeof response.count === "number" && (page + 1) * pageSize >= response.count)) {
      complete = true;
      break;
    }
  }
  if (!complete) {
    throw new Error(`e-Boekhouden invoice search exceeded ${maxPages * pageSize} rows; manual review required before creating another invoice.`);
  }

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
