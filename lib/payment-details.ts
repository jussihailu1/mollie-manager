export type MollieAmountSnapshot = {
  currency: string;
  value: string;
};

export type PaymentInvoiceState =
  | "not_applicable"
  | "pending_invoice"
  | "invoice_creating"
  | "invoice_created"
  | "invoice_sent"
  | "invoice_failed"
  | "skipped";

export type PaymentDrawerData = {
  customerId: string | null;
  customerName: string | null;
  eboekhoudenInvoiceId: string | null;
  eboekhoudenInvoiceNumber: string | null;
  invoicePdfUrl: string | null;
  invoiceState: PaymentInvoiceState;
  localPaymentId: string;
  molliePaymentId: string;
  payment: {
    amount: MollieAmountSnapshot;
    amountCaptured: MollieAmountSnapshot | null;
    amountChargedBack: MollieAmountSnapshot | null;
    amountRefunded: MollieAmountSnapshot | null;
    amountRemaining: MollieAmountSnapshot | null;
    applicationFee: unknown | null;
    authorizedAt: string | null;
    billingAddress: unknown | null;
    cancelUrl: string | null;
    canceledAt: string | null;
    captureBefore: string | null;
    captureDelay: string | null;
    captureMode: string | null;
    countryCode: string | null;
    createdAt: string;
    customerId: string | null;
    description: string;
    details: unknown | null;
    expiredAt: string | null;
    expiresAt: string | null;
    failedAt: string | null;
    isCancelable: boolean | null;
    issuer: string | null;
    lines: unknown[] | null;
    links: Record<string, string>;
    locale: string | null;
    mandateId: string | null;
    metadata: unknown | null;
    method: string | null;
    mode: "live" | "test";
    orderId: string | null;
    paidAt: string | null;
    profileId: string | null;
    redirectUrl: string | null;
    restrictPaymentMethodsToCountry: string | null;
    routing: unknown[] | null;
    sequenceType: string | null;
    settlementAmount: MollieAmountSnapshot | null;
    settlementId: string | null;
    shippingAddress: unknown | null;
    status: string;
    statusReason: {
      code: string;
      message: string;
    } | null;
    subscriptionId: string | null;
    webhookUrl: string | null;
  };
};
