import { type NextRequest } from "next/server";

import { requireViewerSession } from "@/lib/auth/session";
import { listCustomerInvoiceLinks } from "@/lib/customer-invoice-links";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getCustomerDetail } from "@/lib/onboarding/data";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> },
) {
  await requireViewerSession();

  const { customerId } = await params;
  const selectedMode = await getSelectedMollieMode();
  const detail = await getCustomerDetail(customerId, selectedMode);

  if (!detail) {
    return Response.json(
      {
        error: "Customer not found.",
      },
      {
        status: 404,
      },
    );
  }

  const invoices = await listCustomerInvoiceLinks({
    customerId,
    limit: 20,
    mode: selectedMode,
  });

  return Response.json({ invoices });
}
