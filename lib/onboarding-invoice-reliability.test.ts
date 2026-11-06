import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { loadIsolated } from "@/lib/testing/isolated-module";
import { consentPaymentExpiresAt, consentPaymentWindowIsOpen, isCalendarDate, requireConsentPaymentWindow } from "@/lib/onboarding/consent-payment-window";
import { runAcceptSubscriptionConsentFlow } from "@/lib/subscription-consent-flow";
import { runInvoiceEmailAttempt } from "@/lib/invoice-email-attempt";
import { smtpDefinitelyDidNotAccept } from "@/lib/notifications/smtp-outcome";
import { invoiceWatchdogIssues } from "@/lib/reliability/invoice-watchdog-policy";
import * as firstPaymentDelivery from "@/lib/eboekhouden/first-payment-invoice-delivery";
import * as emailCore from "@/lib/notifications/email-core";
import * as smtpOutcome from "@/lib/notifications/smtp-outcome";

describe("onboarding invoice readiness before money moves", () => {
  for (const firstPaymentMode of ["mandate_only", "real_installment"] as const) {
    for (const ready of [false, true]) it(`${firstPaymentMode}: invoice readiness ${ready}`, async () => {
      let creations = 0; let checks = 0;
      const runtime = loadIsolated<typeof import("@/lib/onboarding/first-payment-action-flow")>("lib/onboarding/first-payment-action-flow.ts", {
        "@/lib/onboarding/invoice-readiness": { getOnboardingInvoiceReadiness: async () => { checks++; return { ok: ready, reason: "Link accounting first" }; } },
        "@/lib/onboarding/consent-payment-window": { requireConsentPaymentWindow },
        "@/lib/onboarding/action-helpers": { getLocalCustomer: async () => ({ id: "customer", mollieCustomerId: "cst_fixture" }) },
        "@/lib/onboarding/data": { getCustomerDetail: async () => ({ paymentLinks: [], payments: [] }) },
        "@/lib/onboarding/first-payment-blocker": { resolveFirstPaymentCreationBlocker: () => null },
        "@/lib/onboarding/first-payment-onboarding-flow": { createFirstPaymentOnboardingFlow: async () => { creations++; } },
        "@/lib/onboarding/pending-consent-link": {},
      });
      const result = await runtime.createFirstPaymentActionFlow({ actor: { kind: "user" }, customerId: "customer", tenantId: "tenant", mode: "test",
        planInput: { firstPaymentMode, subscriptionAmountValue: "34.95", subscriptionDescription: "Fixture", subscriptionInterval: "monthly", subscriptionStartDate: "2030-01-01", subscriptionTermMode: "open_ended", totalPayments: null } });
      assert.equal(checks, 1); assert.equal(creations, ready ? 1 : 0); assert.equal(result.status, ready ? "created" : "blocked");
    });
  }
  for (const scenario of [
    { provider: "eboekhouden", relation: null, email: "billing@example.test", smtp: true, valid: true, expected: false },
    { provider: "eboekhouden", relation: "12", email: null, smtp: true, valid: true, expected: false },
    { provider: "eboekhouden", relation: "12", email: "billing@example.test", smtp: false, valid: true, expected: false },
    { provider: "eboekhouden", relation: "12", email: "billing@example.test", smtp: true, valid: false, expected: false },
    { provider: "eboekhouden", relation: "12", email: "billing@example.test", smtp: true, valid: true, expected: true },
    { provider: "eboekhouden", relation: "12", email: "billing@example.test", smtp: true, valid: true, relationUnavailable: true, expected: false },
    { provider: "kify", relation: null, email: null, smtp: true, valid: false, expected: false },
  ]) it(`provider prerequisites: ${JSON.stringify(scenario)}`, async () => {
    const runtime = loadIsolated<typeof import("@/lib/onboarding/invoice-readiness")>("lib/onboarding/invoice-readiness.ts", {
      "server-only": {}, "drizzle-orm": { sql },
      "@/lib/eboekhouden/client": { getEboekhoudenRelation: async () => { if ("relationUnavailable" in scenario) throw new Error("Connection revoked"); return { id: 12 }; } },
      "@/lib/db": { getDb: () => ({ execute: async () => ({ rows: [{ email: scenario.email, relationId: scenario.relation }] }) }) },
      "@/lib/billing-settings": { getTenantBillingSettings: async () => ({ activeInvoiceProvider: scenario.provider, invoiceEmailDeliveryMode: "app_smtp" }), billingSettingsAreComplete: () => true },
      "@/lib/invoicing/kify-readiness-query": { getKifyInvoiceReadiness: async () => ({ ok: scenario.valid, reason: "Incomplete profile" }) },
      "@/lib/invoicing/provider-resolver": { getInvoiceProviderAdapterById: () => ({ validateTenantSetup: async () => ({ ok: scenario.valid }) }) },
      "@/lib/notifications/email": { notificationsAreConfigured: () => scenario.smtp },
    });
    assert.equal((await runtime.getOnboardingInvoiceReadiness({ customerId: "customer", tenantId: "tenant", mode: "test" })).ok, scenario.expected);
  });
});

describe("consent payment deadlines", () => {
  it("rejects impossible calendar dates and keeps leap days", () => {
    for (const value of ["2026-02-29", "2026-02-31", "2026-04-31", "2026-13-01", "2026-1-01"]) assert.equal(isCalendarDate(value), false);
    assert.equal(isCalendarDate("2028-02-29"), true);
  });
  it("keeps invoice notice plus recovery headroom in summer and winter", () => {
    assert.equal(consentPaymentExpiresAt("2026-12-01"), "2026-11-24T22:00:00.000Z");
    assert.equal(consentPaymentExpiresAt("2026-07-01"), "2026-06-24T22:00:00.000Z");
    assert.equal(consentPaymentWindowIsOpen("2026-12-01", 5, new Date("2026-11-24T21:59:59Z")), true);
    assert.equal(consentPaymentWindowIsOpen("2026-12-01", 5, new Date("2026-11-24T22:00:00Z")), false);
    assert.throws(() => requireConsentPaymentWindow("2020-01-01", 5, new Date("2026-11-07")), /later subscription start/);
  });
  for (const acceptedAt of [null, "2026-10-01"]) it(`blocks expired checkout even when consent was previously accepted: ${acceptedAt}`, async () => {
    let marked = false;
    const result = await runAcceptSubscriptionConsentFlow({ acceptedIp: null, acceptedUserAgent: null, formInput: { token: "fixture-token", subscriptionTermsAck: "yes" } }, {
      getConsentByToken: async () => ({ acceptedAt, checkoutUrl: "https://example.test/pay", checkoutBlockedReason: "Expired", consentId: "consent", requiredCheckboxKeys: [] }),
      markConsentAccepted: async () => { marked = true; },
    });
    assert.equal(result.status, "consent_expired"); assert.equal(marked, false); assert.match(result.redirectTo, /^\/subscribe\//);
  });
});

describe("durable invoice email attempts", () => {
  function harness(options: { error?: unknown; recordFailure?: boolean; finishFailure?: boolean } = {}) {
    let state = "new", sends = 0, reports = 0;
    const dependencies = {
      claim: async () => { if (!["new", "failed"].includes(state)) return false; state = "sending"; return true; },
      send: async () => { sends++; if (options.error) throw options.error; },
      record: async (next: "accepted" | "failed" | "uncertain") => { if (options.recordFailure) throw new Error("Database unavailable"); state = next; },
      finish: async () => { if (options.finishFailure) throw new Error("Audit unavailable"); state = "sent"; },
      report: () => { reports++; },
    };
    return { run: () => runInvoiceEmailAttempt(dependencies), state: () => state, sends: () => sends, reports: () => reports };
  }
  it("sends only once when workers overlap", async () => {
    const h = harness(); const results = await Promise.all([h.run(), h.run()]);
    assert.equal(h.sends(), 1); assert.deepEqual(results.map(r => r.status).sort(), ["sent", "skipped"]);
  });
  it("does not replay SMTP acceptance when the owner/audit commit fails", async () => {
    const h = harness({ finishFailure: true }); await h.run(); await h.run();
    assert.equal(h.sends(), 1); assert.equal(h.state(), "accepted"); assert.equal(h.reports(), 1);
  });
  it("holds the claim if acknowledgment persistence is unavailable", async () => {
    const h = harness({ recordFailure: true }); await h.run(); await h.run();
    assert.equal(h.sends(), 1); assert.equal(h.state(), "sending");
  });
  it("does not replay an ambiguous DATA timeout", async () => {
    const h = harness({ error: Object.assign(new Error("SMTP timeout"), { code: "ETIMEDOUT", command: "DATA" }) });
    await assert.rejects(h.run); assert.equal(h.state(), "uncertain"); await h.run(); assert.equal(h.sends(), 1);
  });
  it("allows retry after a definite SMTP rejection", async () => {
    const h = harness({ error: Object.assign(new Error("Temporary rejection"), { responseCode: 451 }) });
    await assert.rejects(h.run); await assert.rejects(h.run); assert.equal(h.sends(), 2); assert.equal(h.state(), "failed");
  });
  it("classifies connect errors separately from uncertain delivery", () => {
    assert.equal(smtpDefinitelyDidNotAccept({ command: "CONN", code: "ETIMEDOUT" }), true);
    assert.equal(smtpDefinitelyDidNotAccept({ command: "DATA", code: "ETIMEDOUT" }), false);
    assert.equal(smtpDefinitelyDidNotAccept(new Error("timeout")), false);
  });
});

describe("independent invoice watchdog", () => {
  const now = Date.parse("2026-11-07T08:00:00Z");
  const healthy = { activeCount: 3, lastSuccess: "2026-11-07T03:23:00Z", overdueCount: 0, blockedCount: 0, stalledCount: 0, uncertainEmailCount: 0 };
  it("does not alert for normal schedule jitter or an unused workspace", () => {
    assert.deepEqual(invoiceWatchdogIssues(healthy, now), []);
    assert.deepEqual(invoiceWatchdogIssues({ ...healthy, lastSuccess: new Date(now - 27 * 3600_000).toISOString() }, now), []);
    assert.deepEqual(invoiceWatchdogIssues({ ...healthy, activeCount: 0, lastSuccess: null }, now), []);
  });
  it("detects a job that never ran and unresolved invoice states", () => {
    assert.deepEqual(invoiceWatchdogIssues({ ...healthy, lastSuccess: null, overdueCount: 1, blockedCount: 1, stalledCount: 1, uncertainEmailCount: 1 }, now).map(i => i.key), ["missed_run", "overdue", "accounting_link", "stalled_creation", "uncertain_email"]);
  });
});

describe("interrupted invoice recovery reconciles before retrying", () => {
  for (const kind of ["first-payment", "recurring"] as const) {
    for (const outcome of ["found", "none", "ambiguous", "unavailable"] as const) it(`${kind}: provider lookup ${outcome}`, async () => {
      const file = `lib/eboekhouden/${kind}-invoices.ts`;
      // Unused module boundaries are inert. Every boundary used by this recovery
      // path is configured below; an accidental new side effect fails the test.
      const mocks: Record<string, unknown> = { "server-only": {} };
      for (const match of readFileSync(file, "utf8").matchAll(/from ["']([^"']+)["']/g)) mocks[match[1]] = {};
      const events: string[] = [];
      const candidate = { tenantId: "tenant", mode: "test", paymentId: "payment", scheduleId: "schedule", customerId: "customer", subscriptionId: "subscription", customerEmail: "invoice@example.test", amountValue: "34.95", eboekhoudenRelationId: 12, invoiceSendDueDate: "2026-11-26", plannedCollectionDate: "2026-12-01", paidAt: "2026-11-01", paymentCreatedAt: "2026-11-01", taxTreatment: "kor" };
      const external = { id: 42, invoiceNumber: "F42", urlPdfFile: "https://example.test/invoice.pdf" };
      Object.assign(mocks, {
        "@/lib/billing-settings": { getTenantActiveInvoiceProvider: async () => "eboekhouden", getTenantBillingSettings: async () => ({ taxTreatment: "kor" }) },
        "@/lib/eboekhouden/stale-invoice-claims": { recoverStaleInvoiceClaims: async () => { events.push("claim recovery"); }, requeueReconciledStaleInvoice: async () => { events.push("requeue"); } },
        "@/lib/eboekhouden/first-payment-invoice-recovery": { listFailedFirstPaymentRecoveryCandidates: async () => [candidate], storeRecoveredFailedFirstPaymentSuccess: async () => { events.push("save existing"); return { invoiceId: "42", invoiceNumber: "F42" }; } },
        "@/lib/eboekhouden/recurring-invoice-recovery": { listFailedRecurringRecoveryCandidates: async () => [candidate], storeRecoveredFailedInvoiceSuccess: async () => { events.push("save existing"); return { invoiceId: "42", invoiceNumber: "F42" }; } },
        "@/lib/eboekhouden/invoice-reference": { buildRecurringInvoiceReference: () => "fixture-reference", buildFirstPaymentInvoiceReference: () => "fixture-reference" },
        "@/lib/eboekhouden/invoice-flow-helpers": { toInvoiceDate: () => "2026-11-01" },
        "@/lib/eboekhouden/first-payment-invoice-date": { resolveFirstPaymentInvoiceDate: () => "2026-11-01" },
        "@/lib/eboekhouden/first-payment-invoice-delivery": firstPaymentDelivery,
        "@/lib/eboekhouden/invoice-reconcile": { findExistingEboekhoudenInvoiceByReference: async () => { events.push("lookup"); if (outcome === "unavailable") throw new Error("Provider unavailable"); return { status: outcome, invoice: external }; } },
        "@/lib/invoicing/tax-treatment": { requireTaxTreatment: () => "kor" },
        "@/lib/eboekhouden/invoice-total-verification": { verifiedEboekhoudenInvoice: async () => { events.push("verify existing"); return external; } },
        "@/lib/invoice-delivery": { deliverCustomerInvoiceEmail: async () => { events.push("deliver existing"); } },
      });
      const runtime = loadIsolated<Record<string, (input: { tenantId: string; mode: "test"; actor: { kind: "system" } }) => Promise<unknown>>>(file, mocks);
      const run = () => runtime[kind === "recurring" ? "recoverFailedRecurringInvoicesBatch" : "recoverFailedFirstPaymentInvoicesBatch"]({ tenantId: "tenant", mode: "test", actor: { kind: "system" } });
      if (outcome === "unavailable") await assert.rejects(run, /Provider unavailable/); else await run();
      assert.deepEqual(events, outcome === "found" ? ["claim recovery", "lookup", "verify existing", "save existing", "deliver existing"] : outcome === "none" ? ["claim recovery", "lookup", "requeue"] : ["claim recovery", "lookup"]);
    });
  }
});

describe("SMTP transport acceptance boundaries", () => {
  for (const command of ["CONN", "DATA"]) it(`only retries a timeout before submission: ${command}`, async () => {
    let transports = 0; let sends = 0;
    const runtime = loadIsolated<typeof import("@/lib/notifications/email")>("lib/notifications/email.ts", {
      "server-only": {},
      "node:dns/promises": { lookup: async () => [{ address: "::1", family: 6 }] },
      "nodemailer-smtp": { default: { createTransport: (config: { connectionTimeout: number; socketTimeout: number }) => {
        assert.equal(config.connectionTimeout, 5000); assert.equal(config.socketTimeout, 10000); transports++;
        return { sendMail: async () => { if (++sends === 1) throw Object.assign(new Error("timeout"), { command, code: "ETIMEDOUT" }); }, close: () => {} };
      } } },
      "@/lib/env": { getNotificationConfig: () => ({ SMTP_HOST: "fixture.test", SMTP_PORT: 465, SMTP_USER: "fixture", SMTP_PASSWORD: "fixture", SMTP_FROM: "sender@example.test" }) },
      "@/lib/notifications/email-core": emailCore,
      "@/lib/notifications/smtp-outcome": smtpOutcome,
    });
    const send = () => runtime.sendEmailTo({ to: "fixture@example.test", subject: "Fixture", text: "Fixture" });
    if (command === "DATA") await assert.rejects(send, /timeout/); else await send();
    assert.equal(transports, command === "CONN" ? 2 : 1);
    assert.equal(sends, command === "CONN" ? 2 : 1);
  });
});
