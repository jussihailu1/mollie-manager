import "server-only";

import { cache } from "react";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";
import { getDatabaseConfig } from "@/lib/env";

declare global {
  var __mollieManagerDb: Database | undefined;
  var __mollieManagerPool: Pool | undefined;
}

function createPool() {
  const config = getDatabaseConfig();

  return new Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL ? true : undefined,
    max: 10,
  });
}

function createDb() {
  return drizzle(getDbPool(), {
    schema,
  });
}

export type Database = ReturnType<typeof createDb>;
export type DbTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
export type DbClient = Database | DbTransaction;

export function isDatabaseConfigured() {
  try {
    getDatabaseConfig();
    return true;
  } catch {
    return false;
  }
}

export function getDbPool() {
  if (!globalThis.__mollieManagerPool) {
    globalThis.__mollieManagerPool = createPool();
  }

  return globalThis.__mollieManagerPool;
}

export function getDb() {
  if (!globalThis.__mollieManagerDb) {
    globalThis.__mollieManagerDb = createDb();
  }

  return globalThis.__mollieManagerDb;
}

export async function transaction<T>(
  callback: (client: DbTransaction) => Promise<T>,
) {
  return getDb().transaction(callback);
}

export const checkDatabaseConnection = cache(async () => {
  if (!isDatabaseConfigured()) {
    return {
      ok: false,
      reason: "DATABASE_URL is not configured.",
    };
  }

  try {
    await getDb().execute(sql`select 1 as ok`);

    return {
      ok: true,
      reason: "Database connection successful.",
    };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error ? error.message : "Unknown database error.",
    };
  }
});
