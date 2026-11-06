# Onboarding recovery timer

This scheduled-only Cloudflare Worker calls Kify's protected onboarding recovery
endpoint every five minutes. It has no public HTTP route and cannot call invoice
batch processing. Request timeout, non-2xx responses and partial results fail the
scheduled invocation rather than reporting success.

Production worker: `kify-onboarding-recovery` in the configured Ayal Web account.
The Worker secret `RECOVERY_SECRET` must match Vercel production's
`ONBOARDING_TIMER_SECRET`. Store secrets outside the repository; never pass values
as CLI arguments. The separate `ONBOARDING_RECOVERY_SECRET` remains available for
the GitHub manual recovery workflow.

```powershell
wrangler deploy --config operations/onboarding-recovery-worker/wrangler.jsonc --env production --dry-run
wrangler deploy --config operations/onboarding-recovery-worker/wrangler.jsonc --env production --secrets-file <private-json-path>
wrangler tail --config operations/onboarding-recovery-worker/wrangler.jsonc --env production
```

The private JSON has one key, `RECOVERY_SECRET`. Deploying preserves existing
secrets when no secrets file is supplied. Cron changes may take up to 15 minutes
to propagate. Verify a genuine scheduled event and correlate its logged run ID
with a successful `onboarding.recovery` audit in Kify, carrying `trigger=schedule`
and `scheduler=cloudflare`. Manual requests are not proof of the timer.

Vercel's daily recovery remains a backup. Its heartbeat check reports an operator
issue if no scheduled recovery has succeeded during the preceding hour. This
check runs daily; it is not a continuously running outage monitor.

If rotating credentials, update the app and Worker together. A failed trigger
must not be "repaired" by creating a new customer payment or replaying invoice
batches. The recovery endpoint discovers existing payment state and uses durable
activation jobs with idempotent provider requests.
