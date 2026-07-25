import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sendNotificationEmailWithTransport } from "@/lib/notifications/email-core";
import { deliverAlertEmailWithDependencies } from "@/lib/reliability/alert-email-delivery";
import type { AlertEmailContent } from "@/lib/reliability/alert-email-template";

describe("alert email delivery integration", () => {
  it("sends multipart SMTP payload (text + html) for alert delivery flow", async () => {
    let composeCalled = false;
    let markCalledWith: string | null = null;
    const sendMailPayloads: Array<{
      attachments?: Array<{
        content: Buffer;
        contentType?: string;
        filename: string;
      }>;
      from: string;
      html?: string;
      subject: string;
      text: string;
      to: string;
    }> = [];

    const emailContent: AlertEmailContent = {
      html: "<h1>Alert</h1><p>Body</p>",
      primaryUrl: "https://manager.example.com/payments/payment_123",
      relatedLinks: [
        {
          label: "Open notifications",
          path: "/notifications",
          url: "https://manager.example.com/notifications",
        },
      ],
      text: "Alert body\n\nOpen in Mollie Manager: https://manager.example.com/payments/payment_123",
    };

    const result = await deliverAlertEmailWithDependencies(
      {
        alertId: "alert_123",
        message: "A payment failed and needs review.",
        tenantId: "tenant_123",
        title: "Failed payment",
      },
      {
        composeAlertEmail: async () => {
          composeCalled = true;
          return emailContent;
        },
        markAlertEmailSent: async (alertId) => {
          markCalledWith = alertId;
        },
        notificationsAreConfigured: () => true,
        sendNotificationEmail: async (message) => {
          await sendNotificationEmailWithTransport({
            envelope: {
              from: "alerts@example.com",
              to: "ops@example.com",
            },
            message,
            transport: {
              sendMail: async (payload: {
                attachments?: Array<{
                  content: Buffer;
                  contentType?: string;
                  filename: string;
                }>;
                from: string;
                html?: string;
                subject: string;
                text: string;
                to: string;
              }) => {
                sendMailPayloads.push(payload);
              },
            },
          });
        },
      },
    );

    assert.equal(composeCalled, true);
    assert.equal(markCalledWith, "alert_123");
    assert.equal(result.delivered, true);
    assert.equal(result.error, null);

    const payload = sendMailPayloads[0];

    if (!payload) {
      throw new Error("Expected SMTP sendMail payload to be captured.");
    }

    assert.equal(payload.from, "alerts@example.com");
    assert.equal(payload.to, "ops@example.com");
    assert.equal(payload.subject, "[Mollie Manager] Failed payment");
    assert.equal(payload.html, emailContent.html);
    assert.equal(payload.text, emailContent.text);
  });
});
