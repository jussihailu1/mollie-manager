# Mollie Connect Connection Contract

Status: accepted for M2 implementation
Audience: product and engineering

## Scope

This contract is for **Mollie Connect for Platforms**, never Marketplace. One
tenant may have one connected Mollie organization initially. A connection is
tenant-owned and organization-level; it is never shared, inferred from another
tenant, or replaced by app-wide credentials. The existing `test`/`live` mode
remains an explicit operation parameter: OAuth-backed calls use Mollie's
`testmode` behavior where the endpoint supports it, rather than storing two
OAuth grants for one organization.

The production callback is `https://kify.app/mollie/connect/callback`. The
configured co-branded back URL is `https://kify.app`; it is a Mollie-hosted
onboarding navigation destination, not an OAuth callback or credential channel.

## Connection and authorization model

- An authenticated operator with access to the currently selected tenant may
  start, reconnect, disconnect, or select its profile. The action always binds
  to that explicit server-resolved tenant; a query parameter, cookie, or form
  field cannot select another tenant.
- A platform operator must still choose a tenant through the existing controlled
  tenant-selection path. It has no global connection or credential fallback.
- A new connect/reconnect attempt creates a single-use, short-lived server-side
  state record bound to tenant id and operator email. The browser receives only
  an opaque state value. The state is consumed atomically before the
  authorization code is exchanged.
- The authorization code, tokens, client secret, and state
  plaintext are never stored in audit details, metadata, logs, URLs after the
  callback, client payloads, or error messages. The callback redirects to a
  clean local URL after handling its parameters.
- Disconnect is an intentional local revocation: delete encrypted OAuth
  material, invalidate any in-process client/cache entry, preserve only safe
  connection history, and block new provider side effects. It does not delete
  tenant business records or silently switch them to an API key.

## Required OAuth scopes

M2/M3 request this fixed least-privilege set, grouped only for readability:

- `organizations.read`, `profiles.read`, `onboarding.read`
- `customers.read`, `customers.write`
- `payments.read`, `payments.write`
- `payment-links.read`, `payment-links.write`
- `mandates.read`, `mandates.write`
- `subscriptions.read`, `subscriptions.write`
- `sales-invoices.read`, `sales-invoices.write`

`sales-invoices.*` authorizes this application's `/v2/sales-invoices` calls.
Do not request `invoices.*`: those permissions apply to different Mollie
resources.

The first group identifies the connected organization, lists selectable
profiles, and reads Capabilities readiness. The remaining groups cover the
existing customer, payment, link, mandate, subscription, reconciliation, and
Mollie-invoicing flows. No refund, chargeback, balance, settlement, application
fee, POS, Marketplace, order, shipment, or profile/organization write scope is
requested. Adding a scope later requires an explicit reconnect, so a scope
change is a contract change and not an implicit refresh.

Profile-bound payment operations must provide the tenant's explicit selected
profile id. A missing, inaccessible, or inactive selected profile is a
fail-closed readiness state; the resolver must not select the first profile.

## States and credential lifecycle

The persisted connection state is one of:

- `connected`: valid encrypted refresh token, required scopes, organization,
  and selected profile are present. Capability readiness is tracked separately.
- `incomplete`: OAuth succeeded but profile selection, required scope
  validation, or Mollie capability readiness prevents the requested operation.
- `revoked`: Mollie rejects refresh/access or the merchant revoked consent.
- `reconnect_required`: the connection is absent, disconnected, has a scope
  mismatch, or cannot be recovered safely.

An OAuth connection stores a safe organization identifier/display name,
selected profile identifier/display name, granted scope names, encrypted refresh
token, and timestamps for connection, verification, refresh, and revocation.
The short-lived access token is encrypted if persisted at all; its expiry is
stored separately. The refresh token is the durable credential and is encrypted
with `APP_ENCRYPTION_KEY` using a dedicated OAuth connection scope, never the
legacy API-key scope.

Before a Mollie call the tenant resolver obtains an unexpired access token. A
single-flight, tenant-and-connection-version-scoped refresh claim prevents
concurrent refreshes from racing. Rotation writes the new encrypted refresh
token and access-token expiry atomically. A failed refresh, invalid grant, 401,
403, required-scope failure, organization mismatch, or profile mismatch clears
usable access material as appropriate, records only a safe reason code, and
transitions to `revoked`, `incomplete`, or `reconnect_required`; it never falls
back to another credential.

Capabilities are read through Mollie's Capabilities API (`onboarding.read`), not
the deprecated Onboarding API. Capability requirements/deep links are sanitized
to an operator-safe next action and are not treated as payment truth.

OAuth-backed test operations send Mollie's `testmode=true` request parameter;
live operations omit it. Sales Invoice creation also sends the selected tenant
profile id for OAuth. API-key requests keep their existing mode-specific key
behavior and do not receive those OAuth-only parameters.

## API-key migration compatibility

The existing encrypted `tenant_mollie_credentials` API key remains a temporary
per-tenant, per-mode compatibility connection. Credential selection is explicit:

1. use a healthy OAuth connection for the exact tenant;
2. otherwise use that exact tenant/mode's legacy API key only when no OAuth
   connection has ever been established for that tenant;
3. an incomplete, revoked, disconnected, or reconnect-required OAuth connection
   fails closed and must not fall back to its API key.

M6 may retire manual API-key onboarding only after live OAuth proof covers every
existing business flow and a migration inventory confirms each active tenant has
either migrated or an approved, time-bounded exception. Existing records retain
their tenant, mode, and provider identifiers throughout migration.

## Safe audit and failure handling

Allowed audit fields are tenant id, actor identity, connection id, mode,
authorization action, outcome, safe state/reason code, organization/profile
ids, granted-scope names, and timestamps. Prohibited fields include all tokens,
authorization codes, client credentials, API keys, state plaintext, raw
provider responses, full callback URLs, and unredacted provider error bodies.

All errors exposed to operators are stable, actionable categories: connect
cancelled, state expired/invalid, scope missing, profile selection required,
capability action required, connection revoked, reconnect required, or temporary
provider failure. Webhooks remain signals: a webhook or replay resolves its
tenant-owned local resource first and re-fetches authoritative Mollie state
through that same tenant's credential resolver.

## M2 acceptance criteria

M2 is complete only when the schema can represent the above connection safely,
OAuth credentials are tenant-scoped, legacy credentials are tenant/mode-scoped,
the declared selection rules hold, encrypted token helpers use
`APP_ENCRYPTION_KEY`, and focused tests prove there is no global or cross-tenant
fallback.
