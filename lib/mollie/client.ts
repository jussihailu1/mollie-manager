import "server-only";

import createMollieClient from "@mollie/api-client";

import {
  env,
  getMollieApiKey,
  getMollieWebhookConfig,
  type MollieMode,
} from "@/lib/env";
import {
  resolveTenantMollieAuthentication,
} from "@/lib/mollie/tenant-connections";

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
    throw new Error("Explicit tenant context is required.");
  }
  const authentication = await resolveTenantMollieAuthentication(tenantId, mode);
  const cacheKey = authentication.kind === "oauth"
    ? `${tenantId}:oauth:${authentication.connectionId}:${authentication.accessToken}`
    : `${tenantId}:api_key:${mode}`;
  const cached = tenantClientCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const client = authentication.kind === "oauth"
    ? createMollieClient({ accessToken: authentication.accessToken })
    : createMollieClient({ apiKey: authentication.apiKey });

  tenantClientCache.set(cacheKey, client);

  return client;
}

export async function getTenantMollieRequestAuthentication(
  tenantId: string,
  mode: MollieMode,
) {
  return resolveTenantMollieAuthentication(tenantId, mode);
}

export async function getTenantMollieRequestContext(
  tenantId: string | undefined,
  mode: MollieMode,
): Promise<{ profileId?: string; testmode?: true }> {
  if (!tenantId) {
    throw new Error("Explicit tenant context is required.");
  }
  const authentication = await resolveTenantMollieAuthentication(tenantId, mode);
  if (authentication.kind !== "oauth") {
    return {};
  }
  return {
    profileId: authentication.profileId,
    ...(mode === "test" ? { testmode: true as const } : {}),
  };
}

export function getMollieWebhookUrl(path = "/api/webhooks/mollie") {
  const config = getMollieWebhookConfig();
  return new URL(path, config.MOLLIE_WEBHOOK_PUBLIC_BASE_URL).toString();
}
