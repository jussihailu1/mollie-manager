import "server-only";

import { cache } from "react";
import type { QueryResultRow } from "pg";
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
