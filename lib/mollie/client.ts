import "server-only";

import createMollieClient from "@mollie/api-client";

import { env, getMollieApiKey, getMollieWebhookConfig, type MollieMode } from "@/lib/env";

type MollieClient = ReturnType<typeof createMollieClient>;

const clientCache = new Map<MollieMode, MollieClient>();

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

export function getMollieWebhookUrl(path = "/api/webhooks/mollie") {
  const config = getMollieWebhookConfig();
  const url = new URL(path, config.MOLLIE_WEBHOOK_PUBLIC_BASE_URL);
  url.searchParams.set("secret", config.MOLLIE_WEBHOOK_SHARED_SECRET);

  return url.toString();
}
