export function buildKifyInvoiceArtifactKey(input: { invoiceId: string; mode: "live" | "test"; snapshotSha256: string; tenantId: string }) {
  return `invoices/${input.tenantId}/${input.mode}/${input.invoiceId}/${input.snapshotSha256}.pdf`;
}
