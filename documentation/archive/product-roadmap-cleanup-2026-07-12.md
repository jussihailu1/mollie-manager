# Product Roadmap Cleanup Snapshot

Status: archived context
Date: 2026-07-12

## Why This Snapshot Exists

The active roadmap and feature inventory had accumulated implementation diaries,
repeated tenant-hardening details, completed phase descriptions, and overlapping
future queues. They were replaced with one sequencing authority and one concise
capability inventory. Git history remains the detailed record.

## Durable Decisions Preserved

- Mollie is payment and mandate truth.
- Every stored invoice remains owned by the provider that created it.
- Tenant context is mandatory for business reads, writes, webhooks, repair,
  replay, cron, invoices, sync, cleanup, and notifications.
- Tenant business flows never fall back to a shared or another tenant's provider account.
- Webhooks are signals; authoritative provider state is re-fetched before action.
- External side effects are idempotent or claim-before-call.
- Money, legal, privacy, and lifecycle policy is documented before dependent code.
- Secrets stay out of URLs, logs, audits, client payloads, and generic metadata.
- Normal operator surfaces remain guided; raw diagnostics and mutation controls
  remain advanced.
- Destructive cleanup starts with report-only and dry-run behavior.

## Capability Baseline At Cleanup

- Shared-app tenant isolation and membership-led access were substantially implemented.
- Tenant-owned API-key credentials drove current Mollie business flows.
- Failed-payment correctness, operator attention, customer timeline, invoice
  automation, delivery, and reliability foundations existed.
- Mollie and e-Boekhouden invoice providers shared provider-neutral stored records.
- Subscription cancellation intent existed, but provider execution did not.
- Tenant subscription-policy defaults existed without a normal edit UI.
- Mollie Connect OAuth, refunds, balance/settlement reconciliation, and broader
  SaaS administration did not exist.

## Superseded Structure

The former roadmap used phases 0 through 7 for failed payments, tenant
foundation, operator attention, customer timeline, operator UX, retention,
subscription operations, catalog/accounting mapping, and policy overrides. Much
of those foundations had already shipped, so phase order no longer represented
the next coherent product goal.

The active roadmap now makes Mollie Connect the single development program and
keeps valid unfinished work in a compact later backlog.
