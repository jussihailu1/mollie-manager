import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import pg from "pg";

loadEnvConfig(process.cwd());

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
const useSsl = process.env.DATABASE_SSL === "true";

if (!connectionString) {
  throw new Error("DATABASE_URL is required to apply migrations.");
}

const migrationPath = path.join(process.cwd(), "db", "migrations", "0001_initial.sql");
const sql = await readFile(migrationPath, "utf8");
const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

try {
  await pool.query(sql);
  console.log(`Applied migration: ${migrationPath}`);
} finally {
  await pool.end();
}
