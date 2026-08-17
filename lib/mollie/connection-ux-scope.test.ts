import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("Mollie Connect operator UX scope", () => {
  const connectionSource = readFileSync(resolve("lib/mollie/tenant-connections.ts"), "utf8");
  const actionsSource = readFileSync(resolve("lib/mollie/connection-actions.ts"), "utf8");
  const settingsSource = readFileSync(resolve("app/(dashboard)/settings/page.tsx"), "utf8");

  it("uses tenant OAuth credentials for profiles, capabilities, and organization only", () => {
    assert.match(connectionSource, /https:\/\/api\.mollie\.com\/v2\/profiles\?limit=250/);
    assert.match(connectionSource, /https:\/\/api\.mollie\.com\/v2\/capabilities/);
    assert.match(connectionSource, /https:\/\/api\.mollie\.com\/v2\/organizations\/me/);
    assert.match(connectionSource, /https:\/\/api\.mollie\.com\/v2\/methods\/\$\{methodId\}/);
    assert.match(connectionSource, /getMethodReadiness\("ideal"\)/);
    assert.match(connectionSource, /getMethodReadiness\("directdebit"\)/);
    assert.match(connectionSource, /response\.status === 403/);
    assert.match(connectionSource, /response\.status === 404/);
    assert.match(connectionSource, /molliePaymentMethodsNeedSetup/);
    assert.match(connectionSource, /getTenantMollieOAuthAccessToken\(tenantId\)/);
    assert.doesNotMatch(connectionSource, /console\.log/);
  });

  it("requires explicit server-verified profile selection", () => {
    assert.match(actionsSource, /getCurrentTenantSelectionForViewer/);
    assert.match(actionsSource, /listTenantMollieProfiles\(currentTenant\.id\)/);
    assert.match(actionsSource, /find\(\(entry\) => entry\.id === profileId\)/);
    assert.match(connectionSource, /status = 'connected', selected_profile_id/);
  });

  it("keeps connection controls and raw provider payloads out of the client surface", () => {
    assert.match(settingsSource, /Mollie Connect/);
    assert.match(settingsSource, /Connect Mollie/);
    assert.match(settingsSource, /Disconnect/);
    assert.match(settingsSource, /Payments: \{formatLabel\(mollieCapabilities\.state\)\}/);
    assert.doesNotMatch(settingsSource, /refreshToken|accessToken|_embedded|requirements/);
  });

  it("uses document navigation for the OAuth redirect route", () => {
    assert.match(settingsSource, /<a href="\/api\/mollie\/connect">Connect Mollie<\/a>/);
    assert.match(settingsSource, /<a href="\/api\/mollie\/connect">Reconnect Mollie<\/a>/);
    assert.doesNotMatch(settingsSource, /<Link href="\/api\/mollie\/connect">/);
  });

  it("keeps Mollie Connect available before advanced operations are gated", () => {
    const advancedOperationsGate = settingsSource.indexOf("if (!canManageAdvancedOperations)");
    const advancedOperationsLoading = settingsSource.indexOf("const [reliabilityOpsSnapshot", advancedOperationsGate);
    const tenantSettingsSource = settingsSource.slice(advancedOperationsGate, advancedOperationsLoading);

    assert.ok(advancedOperationsGate >= 0);
    assert.ok(advancedOperationsLoading >= 0);
    assert.match(tenantSettingsSource, /Mollie Connect/);
    assert.match(tenantSettingsSource, /Connect Mollie/);
  });

  it("surfaces missing required payment methods from Settings with a new-tab Mollie Dashboard link", () => {
    assert.match(settingsSource, /Mollie payment methods need setup/);
    assert.match(settingsSource, /Enable iDEAL for first payments and SEPA Direct Debit for recurring collections/);
    assert.match(settingsSource, /SEPA Direct Debit may need Mollie review and take a few days/);
    assert.match(settingsSource, /href="https:\/\/my\.mollie\.com\/dashboard"/);
    assert.match(settingsSource, /target="_blank"/);
  });

  it("shows Mollie Invoicing setup only for the active Mollie invoice provider", () => {
    assert.match(settingsSource, /Mollie Invoicing needs setup/);
    assert.match(settingsSource, /getTenantMollieInvoicingReadiness/);
    assert.match(settingsSource, /mollieInvoicingReadiness\.required/);
  });
});
