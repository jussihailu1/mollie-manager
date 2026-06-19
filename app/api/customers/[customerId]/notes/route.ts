import { type NextRequest } from "next/server";

import { requireViewerSession } from "@/lib/auth/session";
import { createCustomerNote, listCustomerNotes } from "@/lib/customer-notes";
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

  const notes = await listCustomerNotes({
    customerId,
    limit: 20,
    mode: selectedMode,
  });

  return Response.json({ notes });
}

export async function POST(
  request: NextRequest,
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

  const payload = (await request.json().catch(() => null)) as { body?: unknown } | null;
  const body = typeof payload?.body === "string" ? payload.body : "";
  const note = await createCustomerNote({
    body,
    customerId,
    mode: detail.customer.mode,
  });

  if (!note) {
    return Response.json(
      {
        error: "Note cannot be empty.",
      },
      {
        status: 400,
      },
    );
  }

  return Response.json({ note }, { status: 201 });
}
