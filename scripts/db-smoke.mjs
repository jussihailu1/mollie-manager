import nextEnv from "@next/env";
import pg from "pg";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const connectionString = process.env.DATABASE_URL;
const useSsl = process.env.DATABASE_SSL === "true";

if (!connectionString) {
  throw new Error("DATABASE_URL is required for the database smoke check.");
}

const requiredEnums = [
  "actor_kind",
  "alert_severity",
  "alert_status",
  "audit_outcome",
  "mollie_mode",
  "payment_lifecycle_type",
  "subscription_lifecycle_state",
  "webhook_processing_status",
];

const requiredTables = [
  "customers",
  "mandates",
  "subscriptions",
  "payments",
  "payment_links",
  "alerts",
  "audit_logs",
  "webhook_events",
];

const requiredIndexes = [
  "customers_mode_email_idx",
  "subscriptions_customer_idx",
  "payments_subscription_idx",
  "payment_links_customer_idx",
  "alerts_status_idx",
  "audit_logs_entity_idx",
  "webhook_events_status_idx",
];

function assertPresent(label, required, actual) {
  const missing = required.filter((value) => !actual.has(value));

  if (missing.length > 0) {
    throw new Error(`Missing ${label}: ${missing.join(", ")}`);
  }
}

const { Pool } = pg;
const pool = new Pool({
  connectionString,
  ssl: useSsl ? true : undefined,
});

try {
  const enums = await pool.query(
    `
      select typname
      from pg_type
      where typnamespace = 'public'::regnamespace
        and typname = any($1::name[])
    `,
    [requiredEnums],
  );
  assertPresent(
    "enums",
    requiredEnums,
    new Set(enums.rows.map((row) => row.typname)),
  );

  const tables = await pool.query(
    `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1::text[])
    `,
    [requiredTables],
  );
  assertPresent(
    "tables",
    requiredTables,
    new Set(tables.rows.map((row) => row.table_name)),
  );

  const indexes = await pool.query(
    `
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname = any($1::text[])
    `,
    [requiredIndexes],
  );
  assertPresent(
    "indexes",
    requiredIndexes,
    new Set(indexes.rows.map((row) => row.indexname)),
  );

  const migrationTable = await pool.query(
    "select to_regclass('drizzle.__drizzle_migrations') as migration_table",
  );

  if (!migrationTable.rows[0]?.migration_table) {
    throw new Error("Missing Drizzle migration tracking table.");
  }

  const rowCounts = await pool.query(`
    select 'customers' as table_name, count(*)::int as row_count from customers
    union all
    select 'mandates', count(*)::int from mandates
    union all
    select 'subscriptions', count(*)::int from subscriptions
    union all
    select 'payments', count(*)::int from payments
    union all
    select 'payment_links', count(*)::int from payment_links
    union all
    select 'alerts', count(*)::int from alerts
    union all
    select 'audit_logs', count(*)::int from audit_logs
    union all
    select 'webhook_events', count(*)::int from webhook_events
    order by table_name
  `);

  await pool.query(`
    select
      a.id,
      coalesce(customer.email, fallback_customer.email) as customer_email
    from alerts a
    left join payments p on p.id = a.payment_id
    left join subscriptions s on s.id = a.subscription_id
    left join customers customer on customer.id = a.customer_id
    left join customers fallback_customer on fallback_customer.id = coalesce(p.customer_id, s.customer_id)
    order by a.created_at desc
    limit 1
  `);

  console.log("Database smoke check passed.");
  console.table(rowCounts.rows);
} finally {
  await pool.end();
}
