import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";
import { invoiceDocumentService } from "@/lib/invoicing/invoice-document-runtime";

export async function GET(_request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { currentTenant } = await getCurrentTenantSelectionForViewer();
  const { invoiceId } = await params;
  const document = await invoiceDocumentService.getDocument({ invoiceId, tenantId: currentTenant.id });
  if (!document) return new Response("Not found", { status: 404 });
  if (document.source === "legacy") return Response.redirect(document.url, 302);
  return new Response(document.stream, { headers: { "Cache-Control": "private, no-store", "Content-Type": document.contentType, ...(document.sha256 ? { ETag: `\"${document.sha256}\"` } : {}), "Content-Disposition": `inline; filename=\"${document.filename}\"` } });
}
