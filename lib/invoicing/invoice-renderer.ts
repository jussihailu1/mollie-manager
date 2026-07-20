export type InvoiceRendererId = string;

export type FrozenBillingParty = {
  city: string;
  countryCode: string;
  email: string;
  legalName: string;
  postalCode: string;
  streetAddress: string;
  vatId?: string | null;
};

export type FrozenInvoiceLine = {
  description: string;
  grossCents: number;
  netCents: number;
  quantity: number;
  vatCents: number;
  vatRateBasisPoints: 2100;
};

export type FrozenPaymentContext = {
  kind: "paid_first_installment" | "scheduled_collection";
  molliePaymentId?: string;
  plannedCollectionDate?: string;
};

export type CanonicalInvoiceSnapshot = {
  amountPaidCents: number;
  balanceCents: number;
  currency: "EUR";
  dueDate: string;
  invoiceDate: string;
  invoiceId: string;
  invoiceNumber: string;
  issuer: FrozenBillingParty;
  lines: readonly FrozenInvoiceLine[];
  mode: "live" | "test";
  paymentContext: FrozenPaymentContext;
  recipient: FrozenBillingParty;
  schemaVersion: 1;
  subtotalCents: number;
  tenantId: string;
  totalCents: number;
  vatCents: number;
};

export type RenderedInvoiceDocument = {
  bytes: Buffer;
  contentType: "application/pdf";
  rendererId: InvoiceRendererId;
};

export interface InvoiceDocumentRenderer {
  readonly id: InvoiceRendererId;
  renderPdf(snapshot: CanonicalInvoiceSnapshot): Promise<RenderedInvoiceDocument>;
  validate(snapshot: CanonicalInvoiceSnapshot): void;
}

export class InvoiceRendererRegistry {
  private readonly renderers = new Map<InvoiceRendererId, InvoiceDocumentRenderer>();

  register(renderer: InvoiceDocumentRenderer) {
    if (this.renderers.has(renderer.id)) {
      throw new Error(`Invoice renderer ${renderer.id} is already registered.`);
    }
    this.renderers.set(renderer.id, renderer);
  }

  get(rendererId: InvoiceRendererId) {
    const renderer = this.renderers.get(rendererId);
    if (!renderer) {
      throw new Error(`Invoice renderer ${rendererId} is not registered.`);
    }
    return renderer;
  }
}

export function createFakeInvoiceRenderer(id = "fake-pdf"): InvoiceDocumentRenderer {
  return {
    id,
    async renderPdf(snapshot) {
      this.validate(snapshot);
      return { bytes: Buffer.from(`%PDF-fake:${snapshot.invoiceNumber}`), contentType: "application/pdf", rendererId: id };
    },
    validate(snapshot) {
      if (snapshot.currency !== "EUR" || snapshot.totalCents <= 0) {
        throw new Error("Fake renderer requires a valid EUR invoice snapshot.");
      }
    },
  };
}
