import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTrustedInvoicePdfAttachment,
  normalizeTrustedInvoicePdfUrl,
} from "@/lib/invoice-pdf";

describe("invoice pdf helpers", () => {
  it("accepts trusted e-Boekhouden https urls", () => {
    assert.equal(
      normalizeTrustedInvoicePdfUrl(
        "https://api.e-boekhouden.nl/v1/invoices/123.pdf#download",
      ),
      "https://api.e-boekhouden.nl/v1/invoices/123.pdf",
    );
    assert.equal(
      normalizeTrustedInvoicePdfUrl("https://secure.e-boekhouden.nl/docs/456.pdf"),
      "https://secure.e-boekhouden.nl/docs/456.pdf",
    );
    assert.equal(
      normalizeTrustedInvoicePdfUrl("https://my.mollie.com/dashboard/invoices/789.pdf"),
      "https://my.mollie.com/dashboard/invoices/789.pdf",
    );
  });

  it("rejects untrusted or downgraded invoice urls", () => {
    assert.equal(
      normalizeTrustedInvoicePdfUrl("http://api.e-boekhouden.nl/v1/invoices/123.pdf"),
      null,
    );
    assert.equal(
      normalizeTrustedInvoicePdfUrl("https://api.e-boekhouden.nl@evil.example/doc.pdf"),
      null,
    );
    assert.equal(
      normalizeTrustedInvoicePdfUrl("https://evil.example/doc.pdf"),
      null,
    );
  });

  it("follows trusted redirects and attaches a pdf", async () => {
    const seenUrls: string[] = [];
    const attachmentResult = await buildTrustedInvoicePdfAttachment({
      fetchImpl: async (input) => {
        const url = String(input);
        seenUrls.push(url);

        if (url === "https://api.e-boekhouden.nl/invoices/123.pdf") {
          return new Response(null, {
            headers: {
              location: "https://secure.e-boekhouden.nl/docs/123.pdf",
            },
            status: 302,
          });
        }

        return new Response("%PDF-1.7\nmock\n", {
          headers: {
            "content-type": "application/pdf",
          },
          status: 200,
        });
      },
      invoiceNumber: "2026-001",
      invoicePdfUrl: "https://api.e-boekhouden.nl/invoices/123.pdf",
    });

    assert.deepEqual(seenUrls, [
      "https://api.e-boekhouden.nl/invoices/123.pdf",
      "https://secure.e-boekhouden.nl/docs/123.pdf",
    ]);
    assert.equal(attachmentResult.attachmentStatus, "attached");
    assert.equal(
      attachmentResult.trustedInvoicePdfUrl,
      "https://api.e-boekhouden.nl/invoices/123.pdf",
    );
    assert.equal(
      attachmentResult.attachment?.filename,
      "factuur-2026-001.pdf",
    );
  });

  it("rejects oversized responses before buffering them", async () => {
    const attachmentResult = await buildTrustedInvoicePdfAttachment({
      fetchImpl: async () =>
        new Response("%PDF-1.7\nsmall\n", {
          headers: {
            "content-length": String(6 * 1024 * 1024),
            "content-type": "application/pdf",
          },
          status: 200,
        }),
      invoiceNumber: "2026-002",
      invoicePdfUrl: "https://api.e-boekhouden.nl/invoices/124.pdf",
    });

    assert.equal(attachmentResult.attachment, null);
    assert.equal(attachmentResult.attachmentStatus, "too_large");
    assert.equal(
      attachmentResult.trustedInvoicePdfUrl,
      "https://api.e-boekhouden.nl/invoices/124.pdf",
    );
  });
});
