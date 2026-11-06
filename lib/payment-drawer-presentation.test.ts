import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPaymentNotices } from "./payment-drawer-presentation";

function paidPayment(): NonNullable<Parameters<typeof getPaymentNotices>[0]> {
  return {
    payment: {
      status: "paid",
      statusReason: null,
      amountRefunded: null,
      amountChargedBack: null,
    },
    invoice: {
      state: "invoice_sent",
      sentAt: "2026-11-06T10:00:00Z",
      documentAttachmentStatus: "attached",
      recipientOverridden: false,
      deliveryRecipient: "customer@example.com",
      intendedRecipient: "customer@example.com",
    },
  };
}

describe("payment drawer notices", () => {
  it("does not flag successful payments or ordinary pending payments", () => {
    assert.deepEqual(getPaymentNotices(paidPayment(), "failed"), []);
    assert.deepEqual(getPaymentNotices(null, "pending"), []);
  });

  it("shows unsuccessful saved payments even when live details cannot load", () => {
    for (const status of ["failed", "expired", "canceled"]) {
      const notices = getPaymentNotices(null, status);
      assert.equal(notices.length, 1);
      assert.equal(notices[0].urgent, true);
      assert.match(notices[0].message, /not completed/);
    }
  });

  it("uses the live failure reason instead of the saved status", () => {
    const details = paidPayment();
    details.payment.status = "failed";
    details.payment.statusReason = { code: "insufficient_funds", message: "Insufficient funds" };
    const notices = getPaymentNotices(details, "paid");
    assert.equal(notices[0].title, "Payment failed");
    assert.equal(notices[0].message, "Insufficient funds");
  });

  it("surfaces refunds and chargebacks even while Mollie still reports paid", () => {
    const details = paidPayment();
    details.payment.amountRefunded = { currency: "EUR", value: "12.50" };
    details.payment.amountChargedBack = { currency: "EUR", value: "30.00" };
    const notices = getPaymentNotices(details, "paid");
    assert.deepEqual(notices.map(({ id }) => id), ["chargeback", "refund"]);
    assert.equal(notices[0].urgent, true);
    assert.match(notices[0].message, /30,00/);
    assert.equal(notices[1].urgent, false);
    assert.match(notices[1].message, /12,50/);
    details.payment.amountRefunded.value = "0.00";
    details.payment.amountChargedBack.value = "0.00";
    assert.deepEqual(getPaymentNotices(details, "paid"), []);
  });

  it("flags invoice failures without treating normal invoice preparation as a failure", () => {
    const details = paidPayment();
    details.invoice.state = "invoice_failed";
    assert.equal(getPaymentNotices(details, "paid")[0].id, "invoice-failed");
    details.invoice.state = "invoice_creating";
    details.invoice.sentAt = null;
    assert.deepEqual(getPaymentNotices(details, "paid"), []);
  });

  it("flags each missing-attachment outcome only once the invoice was sent", () => {
    const details = paidPayment();
    for (const status of ["download_failed", "invalid_content_type", "invalid_pdf", "missing_url", "timeout", "too_large", "untrusted_url"] as const) {
      details.invoice.documentAttachmentStatus = status;
      assert.equal(getPaymentNotices(details, "paid")[0].id, "invoice-attachment");
    }
    details.invoice.state = "invoice_failed";
    details.invoice.sentAt = null;
    assert.deepEqual(getPaymentNotices(details, "paid").map(({ id }) => id), ["invoice-failed"]);
    details.invoice.sentAt = "2026-11-06T10:00:00Z";
    assert.deepEqual(getPaymentNotices(details, "paid").map(({ id }) => id), ["invoice-failed", "invoice-attachment"]);
  });

  it("makes a delivery override visible with actual and intended recipients", () => {
    const details = paidPayment();
    details.invoice.recipientOverridden = true;
    details.invoice.deliveryRecipient = "test@example.com";
    const notice = getPaymentNotices(details, "paid")[0];
    assert.equal(notice.id, "invoice-recipient");
    assert.match(notice.message, /test@example.com instead of customer@example.com/);
    details.invoice.state = "invoice_created";
    details.invoice.sentAt = null;
    assert.deepEqual(getPaymentNotices(details, "paid"), []);
  });
});
