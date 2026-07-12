import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("customer notes api surface", () => {
  it("serves and creates notes through an authenticated customer notes api", () => {
    const source = readFileSync(
      resolve("app/api/customers/[customerId]/notes/route.ts"),
      "utf8",
    );

    assert.match(source, /getCurrentTenantSelectionForViewer/);
    assert.match(source, /getSelectedMollieMode/);
    assert.match(source, /getCustomerDetail\(customerId, selectedMode, tenantId\)/);
    assert.match(source, /listCustomerNotes/);
    assert.match(source, /createCustomerNote/);
    assert.match(source, /Response\.json\(\{ note \}, \{ status: 201 \}\)/);
  });

  it("does not place note body in audit details", () => {
    const source = readFileSync(resolve("lib/customer-notes.ts"), "utf8");

    assert.match(source, /writeAuditLog/);
    assert.match(source, /action: "customer_note\.create"/);
    assert.match(source, /noteId/);
    assert.doesNotMatch(source, /details:\s*\{[\s\S]*?body/);
    assert.doesNotMatch(source, /getSingleTenantIdOrThrow/);
    assert.match(source, /tenantId: string;/);
  });

  it("lets the customer drawer add notes and refresh activity", () => {
    const source = readFileSync(resolve("components/customer-flow-dialogs.tsx"), "utf8");

    assert.match(source, /handleAddCustomerNote/);
    assert.match(source, /\/api\/customers\/\$\{encodeURIComponent\(currentCustomerId\)\}\/notes/);
    assert.match(source, /setActivityTimelineRefreshKey/);
    assert.match(source, /Add note/);
  });
});
