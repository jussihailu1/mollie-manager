import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildFailedPaymentCustomerEmail } from "@/lib/failed-payment-customer-email";
import { classifyPaymentOutcome } from "@/lib/payment-outcome-classification";

describe("failed payment customer email composer", () => {
  it("does not compose customer mail for paid or safe-pending payments", () => {
    assert.deepEqual(
      buildFailedPaymentCustomerEmail({
        outcome: classifyPaymentOutcome({
          flowKind: "recurring",
          status: "paid",
        }),
      }),
      {
        reason: "not_customer_notifiable",
        shouldSend: false,
      },
    );

    assert.deepEqual(
      buildFailedPaymentCustomerEmail({
        outcome: classifyPaymentOutcome({
          createdAt: "2026-06-01T10:00:00.000Z",
          flowKind: "recurring",
          now: "2026-06-03T10:00:00.000Z",
          status: "pending",
        }),
      }),
      {
        reason: "not_customer_notifiable",
        shouldSend: false,
      },
    );
  });

  it("composes plain failed-payment copy without penalty or cancellation language", () => {
    const email = buildFailedPaymentCustomerEmail({
      amountCurrency: "EUR",
      amountValue: "49.99",
      contactEmail: "billing@example.com",
      customerName: "Ada BV",
      invoiceNumber: "INV-2026-001",
      outcome: classifyPaymentOutcome({
        flowKind: "recurring",
        status: "failed",
        statusReason: "Insufficient funds",
      }),
      plannedCollectionDate: "2026-06-10",
    });

    assert.equal(email.shouldSend, true);
    assert.equal(email.subject, "Betaling is niet gelukt");
    assert.match(email.text, /Beste Ada BV/);
    assert.match(email.text, /De betaling is niet geslaagd/);
    assert.match(email.text, /Factuur: INV-2026-001/);
    assert.match(email.text, /Bedrag: €\s?49,99/);
    assert.match(email.text, /billing@example\.com/);
    assert.doesNotMatch(email.text, /cancel|annuleer|boete|incasso|dreiging/i);
    assert.doesNotMatch(email.html, /cancel|annuleer|boete|incasso|dreiging/i);
  });

  it("uses mandate-problem copy for failed mandate-only setup", () => {
    const email = buildFailedPaymentCustomerEmail({
      outcome: classifyPaymentOutcome({
        flowKind: "mandate_only",
        status: "expired",
      }),
    });

    assert.equal(email.shouldSend, true);
    assert.equal(email.subject, "Betaling instellen vraagt aandacht");
    assert.match(email.text, /betaalmachtiging of betaalrekening/i);
  });

  it("uses reversal wording for chargebacks and refunds", () => {
    const chargedBack = buildFailedPaymentCustomerEmail({
      outcome: classifyPaymentOutcome({
        flowKind: "recurring",
        hasChargeback: true,
        status: "paid",
      }),
    });
    const reversed = buildFailedPaymentCustomerEmail({
      outcome: classifyPaymentOutcome({
        flowKind: "recurring",
        hasRefundOrReversal: true,
        status: "paid",
      }),
    });

    assert.equal(chargedBack.shouldSend, true);
    assert.match(chargedBack.text, /teruggeboekt via de bank/);
    assert.equal(reversed.shouldSend, true);
    assert.match(reversed.text, /teruggedraaid nadat deze eerder was verwerkt/);
  });

  it("escapes customer-controlled fields in html", () => {
    const email = buildFailedPaymentCustomerEmail({
      customerName: "<script>alert(1)</script>",
      invoiceNumber: "INV-<x>",
      outcome: classifyPaymentOutcome({
        flowKind: "first_payment",
        status: "failed",
      }),
    });

    assert.equal(email.shouldSend, true);
    assert.doesNotMatch(email.html, /<script>/);
    assert.match(email.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(email.html, /INV-&lt;x&gt;/);
  });
});

