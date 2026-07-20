import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";
import { getKifyInvoiceArtifact } from "@/lib/invoicing/kify-document-query";
import { vercelBlobInvoiceArtifactStore } from "@/lib/invoicing/vercel-blob-artifact-store";

export async function GET(_request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { currentTenant } = await getCurrentTenantSelectionForViewer();
  const { invoiceId } = await params;
  const artifact = await getKifyInvoiceArtifact({ invoiceId, tenantId: currentTenant.id });
  if (!artifact) return new Response("Not found", { status: 404 });
  const stream = await vercelBlobInvoiceArtifactStore.read({ key: artifact.locator });
  return new Response(stream, { headers: { "Cache-Control": "private, no-store", "Content-Type": "application/pdf", ETag: `\"${artifact.sha256}\"`, "Content-Disposition": `inline; filename=\"${artifact.invoiceNumber}.pdf\"` } });
}
