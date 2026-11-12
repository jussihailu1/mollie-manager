import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import ts from "typescript";
import type { ReceiptEvidence, ReceiptJob, ReceiptSettings, ReceiptStore } from "./payment-receipt-contract";
import type { ReceiptLink } from "./payment-receipt-preview";

let db: PGlite;
let store: ReceiptStore;
let advanceCursor: (settings: ReceiptSettings, paymentId: string) => Promise<void>;
const dialect = new PgDialect();

before(async () => {
  db = new PGlite();
  // Build the exact deployed 0029 schema, then apply the new migration verbatim.
  // Old history has a duplicate index and is not clean-install replayable; this
  // test intentionally verifies the upgrade from the deployed snapshot instead.
  // No environment variables, network DB or provider are used.
  const baseline = JSON.parse(readFileSync("db/drizzle/meta/0029_snapshot.json", "utf8"));
  for (const statement of await generateMigration(generateDrizzleJson({}), baseline)) await db.exec(statement);
  await db.exec(readFileSync("db/drizzle/0031_eboekhouden_payment_receipts.sql", "utf8"));
  const exports: { createReceiptStore?: (execute: unknown) => ReceiptStore;
    createReceiptCursorAdvancer?: (execute: unknown) => typeof advanceCursor } = {};
  const modules: Record<string, unknown> = {
    "server-only": {}, "node:crypto": { randomUUID }, "drizzle-orm": { sql },
    "@/lib/db": { getDb: () => { throw Error("Production database must not be used in receipt tests"); } },
  };
  const code = ts.transpileModule(readFileSync("lib/eboekhouden/payment-receipt-persistence.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(code, { exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; }, Error, JSON });
  const execute = async (statement: SQL) => {
    const query = dialect.sqlToQuery(statement);
    return db.query(query.sql, query.params);
  };
  store = exports.createReceiptStore!(execute);
  advanceCursor = exports.createReceiptCursorAdvancer!(execute);
});
after(async () => { await db?.close(); });

async function fixture() {
  const suffix = randomUUID().replaceAll("-", "");
  const tenantId = `tenant${suffix}`;
  const paymentId = `payment${suffix}`;
  const invoiceId = `invoice${suffix}`;
  const molliePaymentId = `tr_${suffix}`;
  const settings: ReceiptSettings = { tenantId, mode: "live", enabled: true, profileId: "pfl_fixture", clearingLedgerId: 20,
    paymentsFrom: "2026-11-01T00:00:00Z", credentialVersion: "2026-11-01T12:00:00Z" };
  await db.query("insert into tenants (id,slug,name) values ($1,$1,'Fixture')", [tenantId]);
  await db.query("insert into tenant_eboekhouden_credentials (id,tenant_id,api_source,api_token_ciphertext,updated_at) values ($1,$1,'fixture','not-a-secret',$2)", [tenantId, settings.credentialVersion]);
  await db.query(`insert into tenant_eboekhouden_receipt_settings (tenant_id,mode,enabled,profile_id,clearing_ledger_id,payments_from,credential_version)
    values ($1,'live',true,$2,20,$3,$4)`, [tenantId,settings.profileId,settings.paymentsFrom,settings.credentialVersion]);
  await db.query(`insert into payments (id,tenant_id,mode,payment_type,mollie_payment_id,mollie_status,paid_at,amount_value,amount_currency)
    values ($1,$2,'live','first',$3,'paid','2026-11-11T00:00:00Z',19.99,'EUR')`, [paymentId,tenantId,molliePaymentId]);
  await db.query(`insert into invoices (id,tenant_id,mode,owner_type,owner_id,provider,provider_invoice_id,provider_invoice_number)
    values ($1,$2,'live','payment',$3,'eboekhouden','100','FTEST')`, [invoiceId,tenantId,paymentId]);
  const link: ReceiptLink = { tenantId,mode:"live",invoiceId,paymentId,molliePaymentId,providerInvoiceId:"100",invoiceNumber:"FTEST",relationId:23,
    customerId:"customer",mollieCustomerId:"cst_fixture",ownerType:"payment",ownerId:paymentId,paymentType:"first",status:"paid",paidAt:"2026-11-11T00:00:00Z",amount:{currency:"EUR",value:"19.99"} };
  const evidence: ReceiptEvidence = {
    payload: { type:3,date:"2026-11-11",ledgerId:20,invoiceNumber:"FTEST",relationId:23,inExVat:"IN",description:`Mollie ${molliePaymentId}`,
      entryNumber:`KIFY-PAY-${molliePaymentId}`,paymentReference:`KIFY-PAY-${molliePaymentId}`,checkPaymentReference:true,
      rows:[{amount:19.99,vatCode:"GEEN",invoiceNumber:"FTEST",relationId:23,description:`Mollie ${molliePaymentId}`}] },
    invoiceSnapshot: {id:100,invoiceNumber:"FTEST",relationId:23,date:"2026-11-01",totalAmount:19.99},
  };
  const scope = {tenantId,mode:"live" as const};
  const acquire = () => store.claim({settings,link,evidence});
  const token = (job: ReceiptJob) => { assert.ok(job.claimToken); return {...scope,id:job.id,claimToken:job.claimToken}; };
  return { settings,link,evidence,scope,acquire,token };
}

describe("receipt persistence on ephemeral PostgreSQL", () => {
  it("applies migration 0031 directly after 0029 without deferred OAuth changes", async () => {
    const journal = JSON.parse(readFileSync("db/drizzle/meta/_journal.json", "utf8"));
    assert.equal(journal.entries.at(-1).idx,31); assert.ok(!journal.entries.some((e:{idx:number})=>e.idx===30));
    const before = JSON.parse(readFileSync("db/drizzle/meta/0029_snapshot.json","utf8"));
    const after = JSON.parse(readFileSync("db/drizzle/meta/0031_snapshot.json","utf8"));
    assert.equal(after.prevId,before.id);
    assert.equal(after.tables["public.mollie_oauth_states"].columns.bookkeeping_context,undefined);
    const columns = await db.query("select column_name from information_schema.columns where table_name='mollie_oauth_states' and column_name='bookkeeping_context'");
    assert.equal(columns.rows.length,0);
  });

  it("binds configuration to tenant/live mode and current accounting credentials", async () => {
    const f=await fixture(); const settings=await store.getSettings(f.scope); assert.ok(settings); assert.equal(settings.profileId,f.settings.profileId);
    assert.equal(await store.getSettings({...f.scope,tenantId:"absent"}),null);
    await assert.rejects(()=>store.getSettings({...f.scope,mode:"test"} as never));
    await db.query("update tenant_eboekhouden_credentials set updated_at=updated_at+interval '1 second' where tenant_id=$1",[f.scope.tenantId]);
    await assert.rejects(()=>store.getSettings(f.scope),/Receipt accounting configuration requires review\./);
    assert.equal(await f.acquire(),null);
  });

  it("reports enabled missing credentials while disabled configuration stays disabled",async()=>{
    const f=await fixture(); await db.query("delete from tenant_eboekhouden_credentials where tenant_id=$1",[f.scope.tenantId]);
    await assert.rejects(()=>store.getSettings(f.scope),/Receipt accounting configuration requires review\./);
    await db.query("update tenant_eboekhouden_receipt_settings set enabled=false where tenant_id=$1",[f.scope.tenantId]);
    assert.equal((await store.getSettings(f.scope))?.enabled,false);
  });

  it("persists scheduling cursor without resetting held claims and rejects another tenant's payment",async()=>{
    const f=await fixture(); const g=await fixture(); const job=(await f.acquire())!;
    assert.equal(await store.markPosting({...f.token(job),settings:f.settings}),true);
    assert.equal(await store.markReview({...f.token(job),errorCode:"post_outcome_unverified"}),true);
    const before=await store.getJob({...f.scope,paymentId:f.link.paymentId});
    await advanceCursor(f.settings,f.link.paymentId);
    assert.equal((await store.getSettings(f.scope))?.cursorPaymentId,f.link.paymentId);
    assert.deepEqual(await store.getJob({...f.scope,paymentId:f.link.paymentId}),before);
    await assert.rejects(()=>advanceCursor(f.settings,g.link.paymentId),/Receipt cursor configuration changed\./);
    assert.equal((await store.getSettings(g.scope))?.cursorPaymentId,null);
    await db.query("update tenant_eboekhouden_credentials set updated_at=updated_at+interval '1 second' where tenant_id=$1",[f.scope.tenantId]);
    await assert.rejects(()=>advanceCursor(f.settings,f.link.paymentId),/Receipt cursor configuration changed\./);
    assert.deepEqual(await store.getJob({...f.scope,paymentId:f.link.paymentId}),before);
  });

  it("allows exactly one overlapping claim and persists immutable evidence", async () => {
    const f=await fixture(); const results=await Promise.all([f.acquire(),f.acquire(),f.acquire()]);
    assert.equal(results.filter(Boolean).length,1);
    const job=results.find(Boolean)!;
    assert.equal(job.status,"prepared"); assert.equal(job.attemptedAt,null); assert.deepEqual(job.payload,f.evidence.payload);
    assert.equal(await store.getJob({...f.scope,tenantId:"other",paymentId:f.link.paymentId}),null);
    assert.equal(await store.markPosting({...f.token(job),claimToken:"not-the-claim",settings:f.settings}),false);
    assert.equal(await store.markPosting({...f.token(job),settings:f.settings}),true);
    assert.equal(await store.markPosting({...f.token(job),settings:f.settings}),false);
  });

  it("reclaims stale prepared work with a new token and never replaces its payload", async () => {
    const f=await fixture(); const old=(await f.acquire())!;
    await db.query("update eboekhouden_payment_receipts set claimed_at=now()-interval '16 minutes' where id=$1",[old.id]);
    const changed=structuredClone(f.evidence); changed.payload.date="2026-11-12";
    const current=(await store.claim({settings:f.settings,link:f.link,evidence:changed}))!;
    assert.notEqual(current.claimToken,old.claimToken); assert.deepEqual(current.payload,f.evidence.payload);
    assert.equal(await store.markPosting({...f.token(old),settings:f.settings}),false);
    assert.equal(await store.markVerified({...f.token(old),mutationId:123}),false);
    assert.equal(await store.markPosting({...f.token(current),settings:f.settings}),true);
  });

  it("never retries an attempted receipt; recovery can only hold or verify it", async () => {
    const f=await fixture(); const old=(await f.acquire())!; assert.equal(await store.markPosting({...f.token(old),settings:f.settings}),true);
    await db.query("update eboekhouden_payment_receipts set claimed_at=now()-interval '16 minutes' where id=$1",[old.id]);
    const recovered=(await f.acquire())!;
    assert.equal(recovered.status,"posting"); assert.ok(recovered.attemptedAt);
    assert.equal(await store.markPosting({...f.token(recovered),settings:f.settings}),false);
    assert.equal(await store.releasePrepared(f.token(recovered)),false);
    assert.equal(await store.markReview({...f.token(recovered),errorCode:"post_outcome_unverified"}),true);
    const reviewed=(await f.acquire())!; assert.equal(reviewed.status,"review_required"); assert.equal(reviewed.attemptedAt,recovered.attemptedAt);
    assert.equal(await store.markPosting({...f.token(reviewed),settings:f.settings}),false);
    assert.equal(await store.markVerified({...f.token(reviewed),mutationId:123}),true);
    assert.equal(await f.acquire(),null);
    assert.equal((await store.getJob({...f.scope,paymentId:f.link.paymentId}))?.status,"verified");
  });

  it("can release only an unattempted prepared claim", async () => {
    const f=await fixture(); const old=(await f.acquire())!; assert.equal(await store.releasePrepared(f.token(old)),true);
    const next=(await f.acquire())!; assert.notEqual(next.claimToken,old.claimToken);
    assert.equal(await store.markReview({...f.token(old),errorCode:"stale_worker"}),false);
    assert.equal(await store.markReview({...f.token(next),errorCode:"evidence_changed"}),true);
    const held=(await f.acquire())!; assert.equal(held.status,"review_required"); assert.equal(held.attemptedAt,null);
    assert.equal(await store.releasePrepared(f.token(held)),false);
    assert.equal(await store.markPosting({...f.token(held),settings:f.settings}),false);
  });

  for (const change of [
    "update tenant_eboekhouden_receipt_settings set enabled=false where tenant_id=$1",
    "update tenant_eboekhouden_receipt_settings set profile_id='pfl_changed' where tenant_id=$1",
    "update tenant_eboekhouden_receipt_settings set clearing_ledger_id=21 where tenant_id=$1",
    "update tenant_eboekhouden_receipt_settings set payments_from=payments_from+interval '1 second' where tenant_id=$1",
    "update tenant_eboekhouden_credentials set updated_at=updated_at+interval '1 second' where tenant_id=$1",
    "update payments set mollie_status='failed' where tenant_id=$1",
    "update payments set disputed_at=now() where tenant_id=$1",
    "update payments set collection_review_required_at=now() where tenant_id=$1",
    "update payments set amount_value=29.99 where tenant_id=$1",
    "update payments set amount_currency='USD' where tenant_id=$1",
    "update payments set paid_at=paid_at-interval '1 day' where tenant_id=$1",
    "update invoices set provider_invoice_id='101' where tenant_id=$1",
    "update invoices set owner_id='different-payment' where tenant_id=$1",
    "update invoices set voided_at=now() where tenant_id=$1",
  ]) it(`fences the POST marker after a concurrent change: ${change.split(" set ")[1].split(" where ")[0]}`,async()=>{
    const f=await fixture(); const job=(await f.acquire())!; await db.query(change,[f.scope.tenantId]);
    assert.equal(await store.markPosting({...f.token(job),settings:f.settings}),false);
    const saved=await store.getJob({...f.scope,paymentId:f.link.paymentId}); assert.equal(saved?.status,"prepared"); assert.equal(saved?.attemptedAt,null);
  });

  it("holds expired claims even before another worker has acquired them",async()=>{
    const f=await fixture(); const job=(await f.acquire())!;
    await db.query("update eboekhouden_payment_receipts set claimed_at=now()-interval '16 minutes' where id=$1",[job.id]);
    assert.equal(await store.markPosting({...f.token(job),settings:f.settings}),false);
    assert.equal(await store.markReview({...f.token(job),errorCode:"expired"}),false);
    assert.equal(await store.markVerified({...f.token(job),mutationId:123}),false);
  });

  it("does not enqueue old payments or newly disabled configurations",async()=>{
    const f=await fixture(); await db.query("update payments set paid_at='2026-10-01' where tenant_id=$1",[f.scope.tenantId]);
    assert.equal(await f.acquire(),null);
    const g=await fixture(); await db.query("update tenant_eboekhouden_receipt_settings set enabled=false where tenant_id=$1",[g.scope.tenantId]);
    assert.equal(await g.acquire(),null);
  });

  it("enforces ownership, live-only mode and safe error codes in PostgreSQL",async()=>{
    const f=await fixture(); const g=await fixture(); const job=(await f.acquire())!;
    await assert.rejects(()=>db.query("update eboekhouden_payment_receipts set invoice_id=$1 where id=$2",[g.link.invoiceId,job.id]),{code:"23503"});
    await assert.rejects(()=>db.query("update eboekhouden_payment_receipts set payment_id=$1,mollie_payment_id=$2 where id=$3",[g.link.paymentId,g.link.molliePaymentId,job.id]),{code:"23503"});
    await assert.rejects(()=>db.query("update tenant_eboekhouden_receipt_settings set mode='test' where tenant_id=$1",[g.scope.tenantId]),{code:"23514"});
    await assert.rejects(()=>store.markReview({...f.token(job),errorCode:"provider payload with private data"}));
    await assert.rejects(()=>db.query("update eboekhouden_payment_receipts set error_code='not safe' where id=$1",[job.id]),{code:"23514"});
    assert.equal(await store.markReview({...f.token(job),errorCode:"saved_receipt_requires_review"}),true);
  });

  it("rejects a second invoice receipt and preserves terminal verification",async()=>{
    const f=await fixture(); const first=(await f.acquire())!;
    await assert.rejects(()=>db.query(`insert into eboekhouden_payment_receipts
      select 'duplicate',tenant_id,mode,payment_id,invoice_id,mollie_payment_id,profile_id,clearing_ledger_id,credential_version,
        payload,invoice_snapshot,status,attempted_at,mutation_id,claim_token,claimed_at,error_code,created_at,updated_at
      from eboekhouden_payment_receipts where id=$1`,[first.id]),{code:"23505"});
    assert.equal(await store.markVerified({...f.token(first),mutationId:900}),true);
    await assert.rejects(()=>db.query("update eboekhouden_payment_receipts set status='prepared' where id=$1",[first.id]),{code:"23514"});
  });

  it("cannot assign the same provider mutation to two different tenant-owned invoices",async()=>{
    const f=await fixture(); const first=(await f.acquire())!;
    assert.equal(await store.markVerified({...f.token(first),mutationId:900}),true);
    const paymentId=f.link.paymentId+"second"; const invoiceId=f.link.invoiceId+"second"; const molliePaymentId=f.link.molliePaymentId+"second";
    await db.query(`insert into payments (id,tenant_id,mode,payment_type,mollie_payment_id,mollie_status,paid_at,amount_value,amount_currency)
      values ($1,$2,'live','first',$3,'paid','2026-11-11T00:00:00Z',19.99,'EUR')`,[paymentId,f.scope.tenantId,molliePaymentId]);
    await db.query(`insert into invoices (id,tenant_id,mode,owner_type,owner_id,provider,provider_invoice_id,provider_invoice_number)
      values ($1,$2,'live','payment',$3,'eboekhouden','101','FTEST2')`,[invoiceId,f.scope.tenantId,paymentId]);
    const link={...f.link,paymentId,invoiceId,molliePaymentId,ownerId:paymentId,providerInvoiceId:"101",invoiceNumber:"FTEST2"};
    const evidence=structuredClone(f.evidence); evidence.invoiceSnapshot.id=101; evidence.invoiceSnapshot.invoiceNumber="FTEST2";
    evidence.payload.invoiceNumber="FTEST2"; evidence.payload.rows[0].invoiceNumber="FTEST2";
    evidence.payload.description=`Mollie ${molliePaymentId}`; evidence.payload.rows[0].description=evidence.payload.description;
    evidence.payload.paymentReference=`KIFY-PAY-${molliePaymentId}`; evidence.payload.entryNumber=evidence.payload.paymentReference;
    const second=(await store.claim({settings:f.settings,link,evidence}))!;
    assert.equal(await store.markPosting({...f.token(second),settings:f.settings}),true);
    await assert.rejects(()=>store.markVerified({...f.token(second),mutationId:900}),{code:"23505"});
    const saved=(await store.getJob({...f.scope,paymentId}))!; assert.equal(saved.status,"posting"); assert.equal(saved.mutationId,null);
    assert.equal(await store.markVerified({...f.token(second),mutationId:901}),true);
  });
});
