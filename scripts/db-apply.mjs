import path from "node:path";

import nextEnv from "@next/env";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const connectionString = process.env.DATABASE_URL;
const useSsl = process.env.DATABASE_SSL === "true";

if (!connectionString) {
  throw new Error("DATABASE_URL is required to apply migrations.");
}

const { Pool } = pg;
const pool = new Pool({
  connectionString,
  ssl: useSsl ? true : undefined,
});

try {
  const db = drizzle(pool);

  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), "db", "drizzle"),
  });

  console.log("Applied Drizzle migrations.");
} finally {
  await pool.end();
}
