import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("invoice delivery scope", () => {
  it("threads tenant ids through delivery candidates, metadata lookups, and invoice-state writes", () => {
    const source = readFileSync("lib/invoice-delivery.ts", "utf8");

    assert.match(source, /tenantId: string/);
    assert.doesNotMatch(source, /getSingleTenantIdOrThrow/);
    assert.match(source, /p\.tenant_id as "tenantId"/);
    assert.match(source, /rbs\.tenant_id as "tenantId"/);
    assert.match(source, /tenantId: row\.tenantId/);
    assert.match(source, /tenantId: input\.tenantId/);
    assert.match(
      source,
      /async function getInvoiceEntityMetadata\(input: \{\s+entityId: string;\s+invoiceType: "first_payment" \| "recurring";\s+tenantId: string;\s+\}\)/,
    );
    assert.match(
      source,
      /from payments[\s\S]*where id = \$\{input\.entityId\}[\s\S]*and tenant_id = \$\{input\.tenantId\}[\s\S]*limit 1/,
    );
    assert.match(
      source,
      /from recurring_billing_schedules[\s\S]*where id = \$\{input\.entityId\}[\s\S]*and tenant_id = \$\{input\.tenantId\}[\s\S]*limit 1/,
    );
    assert.match(
      source,
      /update payments[\s\S]*where id = \$\{input\.entityId\}[\s\S]*and tenant_id = \$\{input\.tenantId\}[\s\S]*and invoice_state in \('invoice_created', 'invoice_sent'\)/,
    );
    assert.match(
      source,
      /update recurring_billing_schedules[\s\S]*where id = \$\{input\.entityId\}[\s\S]*and tenant_id = \$\{input\.tenantId\}[\s\S]*and invoice_state in \('invoice_created', 'invoice_sent'\)/,
    );
    assert.doesNotMatch(
      source,
      /where id = \$\{input\.entityId\}\s+and invoice_state in \('invoice_created', 'invoice_sent'\)/,
    );
  });
});
