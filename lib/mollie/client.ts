import "server-only";

import createMollieClient from "@mollie/api-client";

import {
  env,
  getMollieApiKey,
  getMollieWebhookConfig,
  type MollieMode,
} from "@/lib/env";
import {
  resolveTenantMollieConfig,
} from "@/lib/mollie/tenant-credentials";

type MollieClient = ReturnType<typeof createMollieClient>;

const clientCache = new Map<MollieMode, MollieClient>();
const tenantClientCache = new Map<string, MollieClient>();

export function getDefaultMollieMode(): MollieMode {
  return env.MOLLIE_DEFAULT_MODE;
}

export function isMollieConfigured(mode: MollieMode) {
  try {
    getMollieApiKey(mode);
    return true;
  } catch {
    return false;
  }
}

export function getMollieClient(mode: MollieMode = getDefaultMollieMode()) {
  const cached = clientCache.get(mode);

  if (cached) {
    return cached;
  }

  const client = createMollieClient({
    apiKey: getMollieApiKey(mode),
  });

  clientCache.set(mode, client);

  return client;
}

export async function getTenantMollieClient(
  tenantId?: string,
  mode: MollieMode = getDefaultMollieMode(),
) {
  if (!tenantId) {
    return getMollieClient(mode);
  }

  const cacheKey = `${tenantId}:${mode}`;
  const cached = tenantClientCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const config = await resolveTenantMollieConfig(tenantId, mode);
  const client = createMollieClient({
    apiKey: config.MOLLIE_API_KEY,
  });

  tenantClientCache.set(cacheKey, client);

  return client;
}

export function getMollieWebhookUrl(path = "/api/webhooks/mollie") {
  const config = getMollieWebhookConfig();
  return new URL(path, config.MOLLIE_WEBHOOK_PUBLIC_BASE_URL).toString();
}
