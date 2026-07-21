# Kify-Owned Invoicing Implementation Plan

Status: active implementation contract; implementation in progress
Created: 2026-07-21
Active milestone: K7 migration verification and controlled rollout
Audience: product and engineering
Authority: [`implementation-roadmap.md`](./implementation-roadmap.md) remains the sole sequencing authority; this document defines the detailed execution contract for its active Kify-owned invoicing milestone

## Purpose And Completion Definition

Implement tenant-owned invoice issuance that works independently of Mollie
Invoicing or e-Boekhouden. Kify must own the legal invoice identity, immutable
invoice data, rendered PDF, delivery evidence, resend, download, and history.
Mollie remains authoritative for payments, mandates, subscriptions, and payment
state.

This program is complete only when:

- milestones K1 through K7 are implemented and verified;
- one controlled live tenant has completed the acceptance flow;
- active product, architecture, setup, and operations docs match the code;
- milestone K8 retires this active plan into `documentation/archive/` and the
  roadmap names the next active milestone.

Code completion without the live pilot and documentation retirement is not
program completion.

## Current State

The current `InvoiceProviderAdapter` combines upstream invoice creation,
provider readiness, existing-invoice lookup, display metadata, and remote
document retrieval. The `invoices` table stores provider identifiers and a
provider document URL, while first-payment and recurring workflows already
provide tenant fencing, claim-before-call duplicate protection, delivery retry,
resend, audit, and alert behavior.

Existing Mollie and e-Boekhouden invoices are valid historical records. They
must keep their original provider ownership and document behavior. The new Kify
path extends the system; it does not rewrite or backfill historical invoices.

## Locked Decisions

### Ownership And Provider Boundaries

- `kify` becomes an invoice issuer alongside the historical `mollie` and
  `eboekhouden` values.
- Kify owns invoice numbers, immutable snapshots, totals, PDFs, artifacts,
  delivery, resend, download, and history for new Kify invoices.
- Mollie remains payment and mandate truth. A Mollie payment ID or status may be
  referenced, but Mollie is not the issuer of a Kify invoice.
- e-Boekhouden remains an optional future accounting export target. It is not
  required to issue a Kify invoice.
- Existing provider adapters remain available for legacy invoice display and
  document retrieval during and after migration.
- Renderer identity is stored as text, not a PostgreSQL enum, so a renderer can
  be added without changing invoice ownership or migrating the invoice schema.
- Active issuer migration and renderer selection are platform-controlled.
  Normal tenant operators see Kify invoicing and readiness, not a provider or
  renderer selector.

### Native Rendering

- The first production renderer is native PDF generation with `pdfkit` and
  `@types/pdfkit`.
- Bundle embeddable Noto Sans regular and bold font files plus their license in
  the repository. Do not fetch fonts at runtime.
- A tenant logo is optional. When present, load bytes from Kify-controlled
  storage; never fetch an arbitrary remote logo during rendering.
- The initial PDF is Dutch, A4 portrait, and uses a deterministic Kify-owned
  layout. It includes issuer and recipient legal details, invoice number,
  invoice and due dates, description, quantity, VAT-exclusive amount, 21% VAT,
  VAT-inclusive total, payment state, and payment instructions or automatic
  collection wording.
- PDF/A certification is not part of v1. The renderer must still embed fonts,
  set stable document metadata from the invoice snapshot, and produce a normal
  readable PDF.
- Invoice-Generator.com is not implemented in v1. A later adapter requires a
  separately promoted milestone covering commercial permission, DPA/privacy,
  localization, quota metering, alerts, failure semantics, and live proof.

### Money And VAT

- Initial Kify invoices use EUR and one 21% VAT rate only.
- Existing subscription and first-payment amounts are VAT-inclusive because
  Mollie charges that exact stored amount.
- Domain calculations use integer cents. For each v1 line, calculate the
  VAT-exclusive amount by half-up rounding `gross * 10000 / 12100`; VAT is the
  exact remainder `gross - net`. Invoice totals are sums of line amounts.
- The rendered total must equal the related Mollie payment or scheduled
  collection amount exactly.
- Reject unsupported currencies, mixed VAT, negative lines, discounts, credit
  notes, or inconsistent totals before allocating an invoice number.
- Change operator-facing amount copy to state that subscription amounts include
  VAT before migrating a tenant to Kify issuance.

### Scope

Included:

- automated invoices for confirmed paid `real_installment` first payments;
- automated recurring invoices created from recurring billing schedules;
- tenant and customer billing-profile completion flows needed by those paths;
- private PDF storage, email attachment, resend, authenticated download,
  readiness, retry, audit, alerting, and forward-only tenant rollout.

Excluded:

- manual invoice creation;
- quotes, credit notes, refunds, discounts, trials, setup fees, and proration;
- mixed, reduced, exempt, reverse-charge, or foreign VAT;
- UBL, NLCIUS, Peppol, and PDF/A certification;
- e-Boekhouden export or synchronization of Kify invoices;
- backfilling, regenerating, or renumbering existing invoices;
- implementing Invoice-Generator.com or its 100-invoice quota alerts.

## Non-Negotiable Invariants

- Resolve an explicit tenant before every invoice read, mutation, render,
  artifact access, delivery, resend, retry, cron, readiness, and audit action.
- Never use another tenant's profile, customer data, artifact, logo, provider
  credential, invoice sequence, or invoice number.
- Keep test and live invoice sequences separate.
- Preserve the existing unique owner rule: one invoice per tenant, owner type,
  and owner ID.
- Freeze the canonical snapshot and number before rendering or storage.
- Never regenerate an issued invoice from mutable tenant or customer settings.
- Reuse the stored PDF for download and resend.
- Retry a failed render or store operation with the same number and snapshot.
- Never delete an allocated invoice number. A permanently abandoned allocation
  is retained as `void` with an operator-visible reason and audit evidence.
- Keep secrets, full billing profiles, and document bytes out of logs, alerts,
  audits, URLs, and generic metadata.
- A render success is not an artifact-store success, and an artifact-store
  success is not a delivery success. Persist each state separately.

## Target Interfaces

The exact implementation may split these definitions across modules, but the
public contracts and responsibilities must remain equivalent.

```ts
type InvoiceRendererId = string;

type CanonicalInvoiceSnapshot = {
  schemaVersion: 1;
  invoiceId: string;
  tenantId: string;
  mode: "live" | "test";
  invoiceNumber: string;
  issuer: FrozenBillingParty;
  recipient: FrozenBillingParty;
  invoiceDate: string;
  dueDate: string;
  currency: "EUR";
  lines: readonly FrozenInvoiceLine[];
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  amountPaidCents: number;
  balanceCents: number;
  paymentContext: FrozenPaymentContext;
};

type RenderedInvoiceDocument = {
  bytes: Buffer;
  contentType: "application/pdf";
  rendererId: InvoiceRendererId;
};

interface InvoiceDocumentRenderer {
  readonly id: InvoiceRendererId;
  validate(snapshot: CanonicalInvoiceSnapshot): void;
  renderPdf(
    snapshot: CanonicalInvoiceSnapshot,
  ): Promise<RenderedInvoiceDocument>;
}

interface InvoiceArtifactStore {
  put(input: InvoiceArtifactWrite): Promise<StoredInvoiceArtifact>;
  read(locator: InvoiceArtifactLocator): Promise<ReadableStream>;
  head(locator: InvoiceArtifactLocator): Promise<InvoiceArtifactMetadata | null>;
}

interface InvoiceDocumentService {
  getDocument(input: {
    invoiceId: string;
    tenantId: string;
  }): Promise<InvoiceDocumentResult | null>;
}
```

`InvoiceDocumentRenderer` receives only a frozen snapshot. It does not access
the database, Mollie, SMTP, Blob, tenant context, or mutable settings.

`InvoiceArtifactStore` is the only module allowed to depend on Vercel Blob.
Routine invoice code receives only the interface. The interface intentionally
has no general delete method.

`InvoiceDocumentService` serves Kify artifacts from private storage and routes
legacy invoices through their existing provider adapters. Delivery, resend,
download, payment detail, and customer history must consume this service rather
than provider URLs directly.

## Canonical Data Model

Implement forward-only Drizzle and raw SQL migrations together.

### Tenant And Customer Profiles

Add `tenant_invoice_profiles` with explicit `tenant_id` ownership and one row
per tenant. Store:

- legal name and optional trade name;
- street, house number/addition, postal code, city, and ISO country code;
- KVK number and VAT ID;
- invoice email and optional phone;
- optional IBAN and BIC;
- default payment-term days;
- required uppercase invoice prefix;
- optional Kify-controlled logo artifact locator;
- created and updated timestamps.

Add `customer_billing_profiles` with explicit tenant and customer ownership.
Store legal/business name, contact name, structured billing address, country,
email, optional VAT ID, and timestamps. Seed only deterministic existing values.
Never generate `Unknown`, `0000AA`, placeholder legal details, or inferred VAT
identifiers. Incomplete profiles remain visibly incomplete and fail closed.

### Numbers And Canonical Invoices

Add `tenant_invoice_sequences`, unique by tenant, mode, year, and prefix. Allocate
the next value with one atomic database statement while holding the invoice
claim. Format numbers as:

- live: `PREFIX-YYYY-000001`;
- test: `TEST-PREFIX-YYYY-000001`.

Changing a prefix starts a separately traceable series. It never renumbers an
existing invoice.

Add `kify` to `invoice_provider`. Extend `invoices` with nullable canonical
columns so legacy rows remain valid:

- canonical invoice number and status;
- invoice, due, issued, voided, and updated timestamps;
- currency;
- subtotal, VAT, total, amount-paid, and balance integer cents;
- immutable canonical snapshot and snapshot SHA-256;
- void reason.

Use statuses `number_reserved`, `render_pending`, `render_failed`, `issued`, and
`void`. Enforce tenant/mode/canonical-number uniqueness when the canonical
number is present. Keep the existing tenant/owner uniqueness unchanged.

Add ordered `invoice_lines` with tenant and invoice ownership, description,
quantity in fixed decimal units, unit gross cents, net cents, VAT rate basis
points, VAT cents, gross cents, and line position. V1 creation accepts only one
positive line with VAT rate `2100`, while the canonical table shape remains
capable of later multiple-line work.

### Artifacts And Attempts

Add `invoice_artifacts` with tenant and invoice ownership, format, renderer ID,
storage backend, private locator, MIME type, byte size, SHA-256, snapshot hash,
and created timestamp. Accept only one current PDF artifact for a canonical
snapshot.

Add `invoice_render_attempts` with tenant, invoice, renderer ID, attempt number,
status, safe error code, artifact ID, snapshot hash, and timestamps. Native
statuses are `claimed`, `rendered`, `stored`, and `failed`. Do not persist raw
PDF bytes or full party data in attempts.

Use the immutable private object key:

`invoices/{tenantId}/{mode}/{invoiceId}/{snapshotHash}.pdf`

Blob writes must reject replacement. On retry, `head` the deterministic key and
reuse it only when recorded size and SHA-256 match; otherwise fail visibly for
operator review.

## Issuance And Document Flow

### Readiness Before Payment

- A tenant cannot be migrated to Kify until its invoice profile is complete.
- A `real_installment` payment link cannot be created unless the customer's
  billing profile is complete; this avoids accepting payment that cannot be
  invoiced.
- A `mandate_only` EUR 0.01 flow remains allowed because it never creates a
  normal invoice.
- Existing recurring schedules must pass a profile-readiness report before the
  tenant cutover. Incomplete schedules remain blocked and visible.

### Create And Store

1. Resolve tenant and owner; validate eligibility and profile completeness.
2. Build invoice lines and totals from the authoritative payment or schedule.
3. In one transaction, claim the owner row, create the canonical invoice and
   lines, atomically allocate its number, and freeze the snapshot and hash.
4. Render the frozen snapshot with the configured native renderer.
5. Validate non-empty bytes, `application/pdf`, `%PDF-` signature, and a 5 MiB
   maximum.
6. Store the artifact through `InvoiceArtifactStore`, verify metadata and hash,
   and persist the artifact and render-attempt result.
7. Mark the canonical invoice and existing owner tracking row created only
   after durable artifact storage succeeds.
8. Invoke the existing app-owned email delivery flow.

If rendering or storage fails, retain the invoice number and frozen snapshot,
mark `render_failed`, write safe audit and alert evidence, and require the
existing controlled retry path. A retry must not rebuild from current profiles.

### Dates And Payment Presentation

- Paid first installment: use `paid_at` as invoice date, falling back to the
  payment creation date; due date equals invoice date; amount paid equals total;
  balance is zero; do not use future direct-debit wording.
- Recurring schedule: issue on the scheduled invoice-send date; due date equals
  planned collection date; amount paid is zero at issue; state clearly that the
  amount will be collected automatically on that date.
- Later Mollie reconciliation may update payment presentation in Kify's normal
  UI, but it must never mutate an issued PDF or canonical snapshot.

### Download, Delivery, And Legacy Compatibility

Add an authenticated Kify document route at
`GET /api/invoices/[invoiceId]/document`. It must resolve the viewer session and
current tenant, reject cross-tenant access, stream private content with
`Content-Type: application/pdf`, a safe filename, ETag from SHA-256, and private
cache headers, and never expose a Blob URL.

Email delivery and resend load the same stored bytes through
`InvoiceDocumentService`. Legacy Mollie and e-Boekhouden invoices continue to
use their trusted remote document behavior through the same service. Existing
legacy provider IDs, numbers, snapshots, links, and ownership remain unchanged.

## Rollout Rules

- Keep the Kify path behind platform-controlled tenant activation until K7.
- Use the existing active invoice-provider setting internally for migration,
  adding `kify`; remove the normal-operator provider selector and keep issuer
  migration and renderer choice in platform-only controls.
- Do not silently switch a tenant. Run readiness first and record the actor,
  prior provider, new issuer, mode, and timestamp in audit evidence.
- Pilot one controlled test-mode tenant, then one controlled live tenant.
- Existing invoices remain with their original provider. Only invoices created
  after cutover use Kify.
- After live proof, make Kify the default for newly provisioned tenants and
  migrate existing tenants only after their readiness passes.
- Remove Mollie Invoicing activation from normal invoice readiness only after
  the live Kify pilot passes. Keep Mollie connection/payment readiness separate.

## Milestone Execution Contract

Use only these status values: `pending`, `in_progress`, `blocked`, `complete`.
At most one milestone may be `in_progress`. Mark a milestone `complete` only
after its acceptance criteria and commands pass. Record concise evidence in the
progress table; do not turn planned behavior into feature-inventory fact early.

### K1: Canonical Invoice Foundation

Status: complete

Implement profiles, sequence allocation, canonical invoice/line/artifact/attempt
schema, exact VAT-inclusive money helpers, migrations, and profile validation.
Do not connect the new model to live workflows yet.

Acceptance:

- migrations are forward-only and preserve every legacy invoice;
- tenant, mode, owner, sequence, invoice-number, profile, line, artifact, and
  attempt constraints are explicit;
- concurrent allocation cannot duplicate a number;
- unsupported money/VAT cases and incomplete profiles fail before allocation;
- gross total always equals the source Mollie amount.

Verification:

```text
npm run db:generate
npm run db:apply
npm run db:check-raw
node --import tsx --test lib/invoicing/canonical-invoice.test.ts lib/invoicing/invoice-numbering.test.ts lib/invoicing/invoice-profile-validation.test.ts
npm run typecheck
git diff --check
```

### K2: Renderer, Storage, And Document Contracts

Status: complete

Introduce the provider-neutral interfaces, registries, fake renderer, fake
artifact store, and document-service routing contract. Preserve legacy adapter
behavior while moving direct consumers toward `InvoiceDocumentService`.

Acceptance:

- domain and workflow code do not import PDFKit or Vercel Blob;
- renderer tests prove a second fake renderer can be registered without schema
  or workflow changes;
- artifact tests prove storage can be replaced behind the interface;
- document-service tests route Kify and legacy records correctly with explicit
  tenant context.

Verification:

```text
node --import tsx --test lib/invoicing/invoice-renderer-contract.test.ts lib/invoicing/invoice-artifact-store-contract.test.ts lib/invoicing/invoice-document-service.test.ts
npm run typecheck
npm run lint
git diff --check
```

### K3: Native PDFKit Renderer

Status: complete

Add PDFKit, bundled fonts/license, pure layout helpers, Dutch labels, supported
paid/unpaid variants, and a fixture-render command. Renderer input is only the
canonical snapshot.

Acceptance:

- one-page, multi-page, long-address, Unicode, paid, and automatic-collection
  fixtures render without runtime network access;
- every legal field and expected cent total appears in the PDF;
- page breaks repeat column headers and never overlap totals or footer;
- the output passes signature, MIME, non-empty, and size validation;
- visual review confirms readable A4 output at normal print scale.

Verification:

```text
node --import tsx --test lib/invoicing/native-pdf-renderer.test.ts
npm run invoice:render-fixtures
npm run typecheck
npm run lint
git diff --check
```

Record the reviewed fixture paths and visual result before marking K3 complete.

### K4: Private Artifact Storage And Access

Status: complete

Implement the Vercel Private Blob adapter, hash/size verification, deterministic
keys, authenticated document route, and private-stream response behavior.

Acceptance:

- no raw Blob locator reaches client data, email content, audit, or logs;
- duplicate writes cannot replace an accepted PDF;
- matching stored artifacts can be safely recovered after a partial failure;
- authenticated same-tenant reads succeed and cross-tenant/anonymous reads fail;
- the adapter is the only module importing Vercel Blob.

Verification:

```text
node --import tsx --test lib/invoicing/vercel-blob-artifact-store.test.ts lib/invoicing/invoice-document-route.test.ts
npm run test:node
npm run typecheck
npm run lint
git diff --check
```

### K5: Automated Workflow Integration

Status: complete

Add the thin Kify issuer adapter/service and connect it to existing
first-payment and recurring claim flows. Add readiness blockers before real
installment payment-link creation and before tenant cutover.

Acceptance:

- paid real installments and due recurring schedules create exactly one Kify
  invoice and stored PDF;
- mandate-only, unpaid, unsupported, and incomplete-profile paths do not issue;
- failure and retry reuse the same invoice number and snapshot;
- source amount, invoice total, delivery candidate, and owner tracking agree;
- no tenant or global credential fallback is introduced.

Verification:

```text
node --import tsx --test lib/eboekhouden/first-payment-invoice-eligibility.test.ts lib/eboekhouden/first-payment-invoice-workflow-scope.test.ts lib/eboekhouden/recurring-invoice-workflow-scope.test.ts lib/invoicing/kify-invoice-workflow.test.ts
npm run test:node
npm run typecheck
npm run lint
git diff --check
```

### K6: Delivery, Readiness, UX, And Legacy Regression

Status: complete

Move delivery, resend, customer history, payment detail, and download consumers
to `InvoiceDocumentService`; add invoice-profile editing and platform-controlled
cutover UX; separate Kify invoice readiness from Mollie payment readiness.

Acceptance:

- Kify delivery and resend always reuse the stored PDF;
- old Mollie/e-Boekhouden invoices still display and download;
- incomplete profiles have clear normal-operator actions without raw details;
- renderer and migration controls remain platform-only;
- Mollie Invoicing activation is not required for a migrated Kify tenant;
- customer and tenant profile edits cannot mutate an issued invoice.

Verification:

```text
node --import tsx --test lib/customer-invoice-resend.test.ts lib/customer-invoice-resend-scope.test.ts lib/invoice-delivery-retry-flow.test.ts lib/invoice-delivery-scope.test.ts lib/tenant-readiness-scope.test.ts
npm run test:node
npm run typecheck
npm run lint
npm run build
git diff --check
```

### K7: Migration Verification And Controlled Rollout

Status: active

Run full verification, render and inspect final fixtures, prove private storage,
exercise test mode, and then complete one controlled live tenant flow without
changing historical invoices.

Acceptance:

- schema and raw SQL migrations agree and apply cleanly;
- full automated checks pass;
- test tenant proves first-payment, recurring, failure, retry, attachment,
  resend, download, tenant isolation, and legacy history;
- live tenant proves one real-installment invoice and one recurring invoice;
- invoice totals equal Mollie amounts, recipients receive one email per attempt,
  artifacts remain private, and audit/readiness evidence is recorded;
- live rollback is forward-only: pause new Kify issuance while retaining all
  issued invoices and artifacts.

Verification:

```text
npm run db:apply
npm run db:check-raw
npm run test:node
npm run lint
npm run typecheck
npm run build
npm run ops:invoice-readiness
npm run tenant:readiness -- --tenant-id <pilot-tenant-id>
npm run ops:invoice-autonomy-report -- test 50 25
npm run ops:invoice-autonomy-report -- live 50 25
git diff --check
```

Record sanitized test and live evidence in the appropriate operations runbook;
never put customer data, tokens, or document bytes in this plan.

### K8: Documentation Synchronization And Plan Retirement

Status: pending

This milestone is mandatory. Implementation is not complete while this file
remains an active plan.

Required work:

1. Confirm K1 through K7 are complete and the live gate passed.
2. Update the implementation roadmap, feature inventory, architecture overview,
   setup guidance, commands/checks, tenant setup guide, invoice automation
   runbook, retention guidance, and relevant integration docs to actual behavior.
3. Remove temporary implementation instructions and stale active links.
4. Mark this document completed with date, final verification evidence, and
   resulting commit references.
5. Move it to
   `documentation/archive/kify-owned-invoicing-implementation-plan.md`.
6. Promote exactly one next active milestone in the roadmap.
7. Verify no active doc describes this plan as pending or the old provider path
   as the Kify default.

If the program is abandoned or superseded, set the final status and reason,
identify the replacement authority or exact blocker, and archive this document
instead of leaving it active. Do not delete implementation history silently.

Verification:

```text
rg -n "kify-owned-invoicing-implementation-plan|Active Milestone|Kify-owned invoicing" documentation
npm run test:node
npm run lint
npm run typecheck
npm run build
git diff --check
git status --short --branch
```

## Progress And Evidence

Update this table only after the named verification has run. Use sanitized
facts and commit IDs; link detailed live evidence from an operations document.

| Milestone | Status | Verified evidence | Commit |
| --- | --- | --- | --- |
| K1 Canonical invoice foundation | complete | 2026-07-21: paired forward-only Drizzle/raw migrations apply; `npm run db:generate` reports no schema changes; focused canonical-money, numbering, and profile-validation tests pass; `db:check-raw`, typecheck, lint, and diff check pass. | `3b0eda4` + pending verification-snapshot commit |
| K2 Renderer/storage/document contracts | complete | 2026-07-21: replaceable renderer registry, artifact-store contract, and tenant-fenced Kify/legacy document-service routing pass focused tests; typecheck, lint, and diff check pass. | Pending K2 contract commit |
| K3 Native PDFKit renderer | complete | 2026-07-21: native PDFKit renderer embeds bundled Noto Sans fonts; paid, automatic-collection, Unicode/long-address, and three-page fixtures render without runtime network access. Visual review confirms readable A4 output, repeated page headers, and no clipping/overlap. Focused test, fixture command, typecheck, lint, and diff check pass. | `764cbbf` + pending fixture completion commit |
| K4 Private artifact storage and access | complete | 2026-07-21: private deterministic Vercel Blob adapter, tenant-fenced authenticated document route, focused route/store tests, full node suite, typecheck, lint, and diff check pass. Live proof confirms missing-key recovery, private write/read, exact hash/size recovery, and replacement rejection. | `4996bc6`, `1e8730d`, `75e8fa8`, `ba62e38` + pending missing-key fix |
| K5 Automated workflow integration | complete | 2026-07-21: Kify is first-class and fails closed from legacy provider resolution; real-installment links require explicit tenant/customer profiles before side effects. Tenant-fenced claims freeze numbers, snapshots, lines, and attempts before render/storage; retries reuse the frozen snapshot and deterministic artifact key. First-payment and recurring dispatch before legacy adapters; Kify delivery attaches private streamed bytes server-side. Full node suite, typecheck, lint, and diff check pass. | `57a9139`, `6684ce8`, `4d8632f`, `ac6847c`, `881b24c` |
| K6 Delivery, readiness, UX, and legacy regression | complete | 2026-07-21: Kify delivery/resend use stored private artifacts; legacy documents remain available; tenant/customer profile forms are explicit, tenant-fenced, and future-only; Kify readiness does not depend on Mollie Invoicing. Full node suite, typecheck, lint (four pre-existing warnings), build, and diff check pass. | `76f9650`, `e54bd1c`, `266c849`, `2dfc950`, `accf51e`, `9c6144b` |
| K7 Migration verification and controlled rollout | active | 2026-07-21: migrations apply, raw-SQL guard and platform readiness pass. K7 corrected readiness/gate environment loading and backlog use of canonical invoice ownership; test/live backlogs are clean. Pilot proof remains blocked because the Smoke tenant has no live Mollie credentials and is configured for Mollie rather than Kify. | Pending configured Kify pilot tenant and live proof |
| K8 Documentation synchronization and plan retirement | pending | Not started | - |

## Execution Rules

- Start only the first non-complete milestone unless the roadmap explicitly
  changes sequence.
- Implement coherent, reviewable slices; do not attempt the whole program in
  one unverified change.
- Update this plan and active docs in the same slice as verified behavior.
- Preserve unrelated worktree changes and stage only the coherent slice.
- Stop on an exact external blocker only after safe in-scope checks and
  alternatives are exhausted.
- End every slice with completed result, verification evidence, blocker if any,
  and the next unmet acceptance criterion.
