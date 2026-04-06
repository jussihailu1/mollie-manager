import "server-only";

import { cache } from "react";
import type { PoolClient, QueryResultRow } from "pg";
import { Pool } from "pg";

import { getDatabaseConfig } from "@/lib/env";

declare global {
  var __mollieManagerPool: Pool | undefined;
}

function createPool() {
  const config = getDatabaseConfig();

  return new Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
}

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

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
) {
  return getDbPool().query<T>(text, params as unknown[]);
}

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await getDbPool().connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");

    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const checkDatabaseConnection = cache(async () => {
  if (!isDatabaseConfigured()) {
    return {
      ok: false,
      reason: "DATABASE_URL is not configured.",
    };
  }

  try {
    await query("select 1 as ok");

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
