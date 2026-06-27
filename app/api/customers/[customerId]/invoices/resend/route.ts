import { type NextRequest } from "next/server";

import {
  type CustomerInvoiceOwnerType,
  resendCustomerInvoiceEmail,
} from "@/lib/customer-invoice-resend";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { getCustomerDetail } from "@/lib/onboarding/data";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";

function parseOwnerType(value: unknown): CustomerInvoiceOwnerType | null {
  return value === "payment" || value === "recurring_schedule" ? value : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> },
) {
  const { currentTenant, session } = await getCurrentTenantSelectionForViewer();

  const { customerId } = await params;
  const selectedMode = await getSelectedMollieMode();
  const tenantId = currentTenant.id;
  const detail = await getCustomerDetail(customerId, selectedMode, tenantId);

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

  const payload = (await request.json().catch(() => null)) as
    | { ownerId?: unknown; ownerType?: unknown }
    | null;
  const ownerId = typeof payload?.ownerId === "string" ? payload.ownerId : "";
  const ownerType = parseOwnerType(payload?.ownerType);

  if (!ownerId || !ownerType) {
    return Response.json(
      {
        error: "Invoice resend target is invalid.",
      },
      {
        status: 400,
      },
    );
  }

  const result = await resendCustomerInvoiceEmail({
    actor: {
      email: session.user.email,
      kind: "user",
    },
    customerId,
    mode: selectedMode,
    ownerId,
    ownerType,
    tenantId,
  });

  if (result.status === "not_found") {
    return Response.json(
      {
        error: "Invoice target was not found.",
      },
      {
        status: 404,
      },
    );
  }

  return Response.json({ status: result.status });
}
