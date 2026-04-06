import { readdir, readFile } from "node:fs/promises";
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

const migrationsDirectory = path.join(process.cwd(), "db", "migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort((left, right) => left.localeCompare(right));
const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

try {
  for (const migrationFile of migrationFiles) {
    const migrationPath = path.join(migrationsDirectory, migrationFile);
    const sql = await readFile(migrationPath, "utf8");

    await pool.query(sql);
    console.log(`Applied migration: ${migrationPath}`);
  }
} finally {
  await pool.end();
}
