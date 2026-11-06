// Explicit opt-in PostgreSQL integration test. All mutations target connection-
// local temporary tables cloned from the schema, inside a rolled-back transaction.
// No providers or SMTP are called. No production rows are written.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Client } from 'pg';
import ts from 'typescript';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { z } from 'zod';

const envPath = process.argv[2];
if (!envPath) throw new Error('Pass the environment file for explicit SQL test opt-in.');
const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find(value => value.startsWith('DATABASE_URL='));
if (!line) throw new Error('Database configuration missing.');
const raw = line.slice('DATABASE_URL='.length).trim();
const connectionString = raw.startsWith('"') ? JSON.parse(raw) : raw;
const client = new Client({ connectionString });
const tenant = process.argv[3];
if (!tenant) throw new Error('Pass the fixture tenant id as the second argument.');
const dialect = new PgDialect();
const execute = statement => { const query = dialect.sqlToQuery(statement); return client.query(query.sql, query.params); };
const db = { getDb: () => ({ execute }), transaction: async fn => fn({ execute }) };
const modules = { 'server-only': {}, 'drizzle-orm': { sql }, '@/lib/db': db };
function load(path, extra = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, crypto, Date, Error, console, JSON,
    require(name) { assert.ok(name in extra || name in modules, `Unmocked boundary: ${name}`); return name in extra ? extra[name] : modules[name]; } });
  return exports;
}
await client.connect();
try {
  await client.query('begin');
  const tables = ['payments','payment_links','subscription_onboarding_consents','recurring_billing_schedules','invoices','subscriptions','customers','customer_billing_profiles','customer_accounting_links','tenant_billing_settings','audit_logs','alerts'];
  for (const table of tables) {
    // Identifiers come exclusively from the fixed allowlist above.
    await client.query(`create temporary table "${table}" (like public."${table}" including defaults including constraints including indexes) on commit drop`);
  }
  await client.query('set local search_path = pg_temp, public');
  for (const table of tables) {
    const check = await client.query('select to_regclass($1)::oid = to_regclass($2)::oid as isolated', [table, `pg_temp.${table}`]);
    assert.equal(check.rows[0].isolated, true);
    if (table === 'alerts') continue;
    if (table === 'audit_logs') await client.query(`insert into pg_temp.audit_logs select * from public.audit_logs where entity_id = $1 and action = 'recurring_invoice.cron_batch_create'`, [tenant]);
    else await client.query(`insert into pg_temp."${table}" select * from public."${table}" where tenant_id = $1`, [tenant]);
  }
  const attempts = load('lib/invoice-email-attempt-store.ts');
  const policy = load('lib/reliability/invoice-watchdog-policy.ts');
  const alerts = load('lib/reliability/alerts.ts', {
    '@/lib/notifications/email': {}, '@/lib/reliability/alert-email': {}, '@/lib/reliability/alert-email-delivery': {},
  });
  let mails = 0;
  const watchdog = load('lib/reliability/invoice-watchdog.ts', {
    '@/lib/reliability/alerts': alerts, '@/lib/notifications/email': { sendOperatorEmailOnce: async () => { mails++; } },
    '@/lib/invoice-email-attempt-store': attempts, '@/lib/reliability/invoice-watchdog-policy': policy,
    '@/lib/audit': { writeAuditLog: async () => {} },
  });
  assert.equal((await watchdog.checkInvoiceAutomation({ id: tenant, name: 'Fixture' })).issueCount, 0);
  await client.query("update pg_temp.audit_logs set created_at = now() - interval '28 hours'");
  assert.equal((await watchdog.checkInvoiceAutomation({ id: tenant, name: 'Fixture' })).issueCount, 1);
  await watchdog.checkInvoiceAutomation({ id: tenant, name: 'Fixture' });
  assert.equal(mails, 1, 'repeated watchdog runs must not duplicate alert emails');
  await client.query("update pg_temp.audit_logs set created_at = now(), outcome = 'success'");
  assert.equal((await watchdog.checkInvoiceAutomation({ id: tenant, name: 'Fixture' })).issueCount, 0);
  assert.equal((await client.query("select count(*)::int as count from pg_temp.alerts where status = 'open'")).rows[0].count, 0);
  console.log('PASS PostgreSQL watchdog detection, alert deduplication and resolution');

  const billingPolicy = load('lib/recurring-billing-policy.ts', {'@/lib/payment-outcome-classification': {}});
  const windowPolicy = load('lib/onboarding/consent-payment-window.ts', {'@/lib/recurring-billing-policy': billingPolicy});
  const acceptance = load('lib/subscription-consent-acceptance.ts', {zod:{z}});
  const consent = load('lib/subscription-consent.ts', {
    zod:{z}, 'next/navigation':{}, 'next/headers':{}, '@/lib/env':{env:{APP_URL:'https://example.test'}},
    '@/lib/onboarding/consent-payment-window':windowPolicy, '@/lib/subscription-consent-acceptance':acceptance,
    '@/lib/subscription-consent-flow':{}, '@/lib/recurring-billing-policy':billingPolicy,
    '@/lib/onboarding/consent-token-storage': {hashConsentToken:()=> 'a'.repeat(64),resolveStoredConsentToken:()=> 'fixture-token'},
  });
  const consentRow=(await client.query('select id,payment_link_id from pg_temp.subscription_onboarding_consents where tenant_id=$1 order by created_at desc limit 1',[tenant])).rows[0];
  assert.ok(consentRow);
  await client.query("update pg_temp.subscription_onboarding_consents set consent_token=null,consent_token_ciphertext='fixture-cipher',consent_token_hash=$2,plan_snapshot=jsonb_set(plan_snapshot,'{startDate}','\"2030-01-01\"') where id=$1",[consentRow.id,'a'.repeat(64)]);
  await client.query("update pg_temp.payment_links set mollie_status='open',expires_at=null where id=$1",[consentRow.payment_link_id]);
  assert.ok((await consent.getSubscriptionConsentByToken('fixture-token')).checkoutUrl);
  await client.query("update pg_temp.subscription_onboarding_consents set plan_snapshot=jsonb_set(plan_snapshot,'{startDate}','\"2020-01-01\"') where id=$1",[consentRow.id]);
  assert.equal((await consent.getSubscriptionConsentByToken('fixture-token')).checkoutUrl,null);
  await client.query("update pg_temp.payment_links set mollie_status='paid' where id=$1",[consentRow.payment_link_id]);
  const paidConsent=await consent.getSubscriptionConsentByToken('fixture-token');
  assert.equal(paidConsent.checkoutUrl,null); assert.match(paidConsent.checkoutBlockedReason,/already been received/);
  console.log('PASS PostgreSQL consent lookup blocks expired and already-paid checkout');

  const emailSql = load('lib/invoicing/billing-recipient.ts');
  const resend = load('lib/customer-invoice-resend.ts', {
    '@/lib/invoicing/billing-recipient': emailSql, '@/lib/invoice-delivery': {}, '@/lib/customer-invoice-resend-flow': {},
  });
  const fixture = (await client.query(`select r.id, s.customer_id, i.provider_invoice_id, i.id as invoice_id from pg_temp.recurring_billing_schedules r join pg_temp.subscriptions s on s.id=r.subscription_id join pg_temp.invoices i on i.owner_id=r.id and i.owner_type='recurring_schedule' where r.mode='live' and i.provider='eboekhouden' limit 1`)).rows[0];
  assert.ok(fixture);
  await client.query('update pg_temp.customer_billing_profiles set email=$1 where customer_id=$2', ['billing.fixture@example.test',fixture.customer_id]);
  await client.query('update pg_temp.customers set email=$1 where id=$2', ['contact.fixture@example.test',fixture.customer_id]);
  const target = await resend.loadCustomerInvoiceResendTarget({ tenantId: tenant, mode: 'live', customerId: fixture.customer_id, ownerId: fixture.id, ownerType: 'recurring_schedule' });
  assert.equal(target.invoiceId, fixture.provider_invoice_id);
  assert.notEqual(target.invoiceId, fixture.invoice_id);
  assert.equal(target.customerEmail,'billing.fixture@example.test');
  assert.equal(await resend.loadCustomerInvoiceResendTarget({ tenantId:'00000000-0000-4000-8000-000000000000',mode:'live',customerId:fixture.customer_id,ownerId:fixture.id,ownerType:'recurring_schedule'}),null);
  console.log('PASS PostgreSQL resend provider identity, invoice-profile recipient and tenant isolation');

  const input = { ...target, actor: { kind: 'system' } };
  await client.query("update pg_temp.recurring_billing_schedules set invoice_state='invoice_created', metadata='{}'::jsonb where id=$1",[fixture.id]);
  assert.equal(await attempts.claimInvoiceEmailAttempt(input,'attempt-1','billing.fixture@example.test'),true);
  assert.equal(await attempts.claimInvoiceEmailAttempt(input,'attempt-2','billing.fixture@example.test'),false);
  await attempts.recordInvoiceEmailAttempt(input,'attempt-1','accepted');
  await attempts.finishAcceptedInvoiceEmails({tenantId:tenant,mode:'live'});
  assert.equal((await client.query('select invoice_state from pg_temp.recurring_billing_schedules where id=$1',[fixture.id])).rows[0].invoice_state,'invoice_sent');
  assert.equal(await attempts.claimInvoiceEmailAttempt(input,'attempt-3','billing.fixture@example.test'),false);
  const manual = {...input,allowResend:true};
  assert.equal(await attempts.claimInvoiceEmailAttempt(manual,'attempt-4','billing.fixture@example.test'),true);
  await attempts.recordInvoiceEmailAttempt(manual,'attempt-4','uncertain');
  assert.equal(await attempts.claimInvoiceEmailAttempt(manual,'attempt-5','billing.fixture@example.test'),false);
  console.log('PASS PostgreSQL email claim exclusion, accepted-send recovery and uncertain-send hold');

  const stale = load('lib/eboekhouden/stale-invoice-claims.ts');
  const pending = (await client.query("select r.id from pg_temp.recurring_billing_schedules r where invoice_state='pending_invoice' and not exists(select 1 from pg_temp.invoices i where i.owner_id=r.id) limit 1")).rows[0];
  assert.ok(pending);
  await client.query("update pg_temp.recurring_billing_schedules set invoice_state='invoice_creating',updated_at=now(),metadata='{}'::jsonb where id=$1",[pending.id]);
  await stale.recoverStaleInvoiceClaims({tenantId:tenant,mode:'live',ownerType:'recurring_schedule'});
  assert.equal((await client.query('select invoice_state from pg_temp.recurring_billing_schedules where id=$1',[pending.id])).rows[0].invoice_state,'invoice_creating');
  await client.query("update pg_temp.recurring_billing_schedules set updated_at=now()-interval '16 minutes' where id=$1",[pending.id]);
  await stale.recoverStaleInvoiceClaims({tenantId:tenant,mode:'live',ownerType:'recurring_schedule'});
  const recovered=(await client.query('select invoice_state, metadata from pg_temp.recurring_billing_schedules where id=$1',[pending.id])).rows[0];
  assert.equal(recovered.invoice_state,'invoice_failed'); assert.equal(recovered.metadata.invoiceCreationManualReview,true);
  await stale.requeueReconciledStaleInvoice({tenantId:tenant,mode:'live',ownerId:pending.id,ownerType:'recurring_schedule'});
  assert.equal((await client.query('select invoice_state from pg_temp.recurring_billing_schedules where id=$1',[pending.id])).rows[0].invoice_state,'pending_invoice');
  console.log('PASS PostgreSQL live-claim protection and stale-claim reconciliation queue');
} finally {
  await client.query('rollback');
  await client.end();
}
console.log('PASS all integration checks; transaction rolled back and temporary tables removed');
