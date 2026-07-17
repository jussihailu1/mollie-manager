# Mollie Connect Live Proof

Status: required before Connect completion

Use one real connected tenant and record only IDs, timestamps, safe outcomes,
and operator-visible states. Never record OAuth tokens, client credentials,
authorization codes, raw callback URLs, or raw provider responses.

## Required evidence

- OAuth connect, organization verification, capability check, and explicit
  profile selection complete.
- OAuth-backed customer creation succeeds.
- First payment and payment link are created; webhook intake re-fetches and
  persists authoritative Mollie state.
- Mandate establishment and subscription activation succeed.
- Reconciliation refreshes customer, payment, mandate, subscription, and link
  state under the same tenant.
- Mollie Sales Invoice creation and document retrieval succeed if the tenant has
  Mollie Invoicing activated; otherwise record that external activation blocker.
- Revoking consent or disconnecting makes the tenant fail closed with an
  actionable reconnect state and no API-key fallback.
- Reconnect and explicit profile selection restore the same tenant only.
- Readiness reports the connected organization/profile/capability state without
  secrets or raw provider payloads.

## Migration gate

Do not remove API-key onboarding until every active tenant is either live-proven
on OAuth or has a documented, time-bounded exception. Existing records keep
their tenant, mode, and provider identifiers throughout migration.
