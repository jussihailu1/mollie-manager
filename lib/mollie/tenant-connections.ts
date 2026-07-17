import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb, transaction } from "@/lib/db";
import { getMollieConnectConfig, type MollieMode } from "@/lib/env";
import {
  decryptTenantCredential,
  encryptTenantCredential,
} from "@/lib/tenant-credential-encryption";
import { getTenantMollieCredentials, TenantMollieCredentialError } from "@/lib/mollie/tenant-credentials";

const TENANT_MOLLIE_OAUTH_SCOPE = "mollie-manager:tenant-mollie-oauth:";
export const REQUIRED_MOLLIE_CONNECT_SCOPES = [
  "organizations.read", "profiles.read", "onboarding.read", "customers.read",
  "customers.write", "payments.read", "payments.write", "payment-links.read",
  "payment-links.write", "mandates.read", "mandates.write", "subscriptions.read",
  "subscriptions.write", "sales-invoices.read", "sales-invoices.write",
] as const;

export type TenantMollieConnectionStatus =
  | "connected"
  | "incomplete"
  | "revoked"
  | "reconnect_required"
  | "disconnected";

type StoredConnection = {
  accessTokenCiphertext: string | null;
  accessTokenExpiresAt: string | null;
  credentialVersion: number;
  failureReasonCode: string | null;
  grantedScopes: string[];
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  refreshTokenCiphertext: string | null;
  selectedProfileId: string | null;
  selectedProfileName: string | null;
  status: TenantMollieConnectionStatus;
};

type TokenResponse = { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string };

function requireTenantId(tenantId?: string) {
  if (!tenantId) {
    throw new TenantMollieCredentialError("Explicit tenant context is required.");
  }

  return tenantId;
}

export function encryptTenantMollieOAuthToken(token: string) {
  return encryptTenantCredential(token, {
    createError: (message) => new TenantMollieCredentialError(message),
    currentSecret: process.env.APP_ENCRYPTION_KEY,
    currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.",
    scope: TENANT_MOLLIE_OAUTH_SCOPE,
  });
}

export function decryptTenantMollieOAuthToken(ciphertext: string) {
  return decryptTenantCredential(ciphertext, {
    createError: (message) => new TenantMollieCredentialError(message),
    currentSecret: process.env.APP_ENCRYPTION_KEY,
    currentSecretMissingMessage: "APP_ENCRYPTION_KEY is missing.",
    invalidMessage: "Stored tenant Mollie OAuth credentials are invalid.",
    legacySecret: undefined,
    legacySecretMissingMessage: "Stored tenant Mollie OAuth credentials are invalid.",
    scope: TENANT_MOLLIE_OAUTH_SCOPE,
  });
}

export async function getTenantMollieConnection(tenantId?: string) {
  const result = await getDb().execute<StoredConnection>(sql`
    select
      id,
      status,
      organization_id as "organizationId",
      organization_name as "organizationName",
      selected_profile_id as "selectedProfileId",
      selected_profile_name as "selectedProfileName",
      granted_scopes as "grantedScopes",
      refresh_token_ciphertext as "refreshTokenCiphertext",
      access_token_ciphertext as "accessTokenCiphertext",
      access_token_expires_at as "accessTokenExpiresAt",
      credential_version as "credentialVersion",
      failure_reason_code as "failureReasonCode"
    from tenant_mollie_connections
    where tenant_id = ${requireTenantId(tenantId)}
    limit 1
  `);

  return result.rows[0] ?? null;
}

export async function upsertTenantMollieConnection(input: {
  tenantId: string;
  status: TenantMollieConnectionStatus;
  organizationId?: string | null;
  organizationName?: string | null;
  selectedProfileId?: string | null;
  selectedProfileName?: string | null;
  grantedScopes?: string[];
  refreshToken?: string | null;
  accessToken?: string | null;
  accessTokenExpiresAt?: string | null;
  failureReasonCode?: string | null;
}) {
  const tenantId = requireTenantId(input.tenantId);
  const refreshTokenCiphertext = input.refreshToken
    ? encryptTenantMollieOAuthToken(input.refreshToken)
    : null;
  const accessTokenCiphertext = input.accessToken
    ? encryptTenantMollieOAuthToken(input.accessToken)
    : null;

  await transaction(async (tx) => {
    await tx.execute(sql`
      insert into tenant_mollie_connections (
        id, tenant_id, status, organization_id, organization_name,
        selected_profile_id, selected_profile_name, granted_scopes,
        refresh_token_ciphertext, access_token_ciphertext, access_token_expires_at,
        failure_reason_code, connected_at, created_at, updated_at
      ) values (
        ${randomUUID()}, ${tenantId}, ${input.status}, ${input.organizationId ?? null},
        ${input.organizationName ?? null}, ${input.selectedProfileId ?? null},
        ${input.selectedProfileName ?? null}, ${JSON.stringify(input.grantedScopes ?? [])}::jsonb,
        ${refreshTokenCiphertext}, ${accessTokenCiphertext}, ${input.accessTokenExpiresAt ?? null},
        ${input.failureReasonCode ?? null},
        case when ${input.status} = 'connected' then now() else null end, now(), now()
      )
      on conflict (tenant_id) do update set
        status = excluded.status,
        organization_id = excluded.organization_id,
        organization_name = excluded.organization_name,
        selected_profile_id = excluded.selected_profile_id,
        selected_profile_name = excluded.selected_profile_name,
        granted_scopes = excluded.granted_scopes,
        refresh_token_ciphertext = case
          when excluded.status in ('revoked', 'reconnect_required', 'disconnected') then null
          else coalesce(excluded.refresh_token_ciphertext, tenant_mollie_connections.refresh_token_ciphertext)
        end,
        access_token_ciphertext = excluded.access_token_ciphertext,
        access_token_expires_at = excluded.access_token_expires_at,
        failure_reason_code = excluded.failure_reason_code,
        connected_at = case when excluded.status = 'connected' then now() else tenant_mollie_connections.connected_at end,
        updated_at = now()
    `);
  });
}

function hasRequiredScopes(scopes: string[]) {
  const granted = new Set(scopes);
  return REQUIRED_MOLLIE_CONNECT_SCOPES.every((scope) => granted.has(scope));
}

async function exchangeRefreshToken(refreshToken: string) {
  const config = getMollieConnectConfig();
  const basic = Buffer.from(`${config.MOLLIE_CONNECT_CLIENT_ID}:${config.MOLLIE_CONNECT_CLIENT_SECRET}`).toString("base64");
  const response = await fetch("https://api.mollie.com/oauth2/tokens", {
    method: "POST",
    headers: { Accept: "application/json", Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, redirect_uri: config.MOLLIE_CONNECT_REDIRECT_URI }),
    cache: "no-store",
  });
  if (!response.ok) throw new TenantMollieCredentialError("Tenant Mollie reconnect is required.");
  const token = (await response.json()) as TokenResponse;
  if (!token.access_token) throw new TenantMollieCredentialError("Tenant Mollie reconnect is required.");
  return token;
}

export async function getTenantMollieOAuthAccessToken(tenantId: string) {
  const resolvedTenantId = requireTenantId(tenantId);
  return transaction(async (tx) => {
    const result = await tx.execute<StoredConnection>(sql`
      select id, status, organization_id as "organizationId", organization_name as "organizationName",
        selected_profile_id as "selectedProfileId", selected_profile_name as "selectedProfileName",
        granted_scopes as "grantedScopes", refresh_token_ciphertext as "refreshTokenCiphertext",
        access_token_ciphertext as "accessTokenCiphertext", access_token_expires_at as "accessTokenExpiresAt",
        credential_version as "credentialVersion", failure_reason_code as "failureReasonCode"
      from tenant_mollie_connections where tenant_id = ${resolvedTenantId} for update
    `);
    const connection = result.rows[0];
    if (!connection || !["connected", "incomplete"].includes(connection.status) || !connection.refreshTokenCiphertext || !hasRequiredScopes(connection.grantedScopes)) {
      throw new TenantMollieCredentialError("Tenant Mollie reconnect is required.");
    }
    const expiresAt = connection.accessTokenExpiresAt ? new Date(connection.accessTokenExpiresAt).getTime() : 0;
    if (connection.accessTokenCiphertext && expiresAt > Date.now() + 120_000) {
      return decryptTenantMollieOAuthToken(connection.accessTokenCiphertext);
    }
    try {
      const token = await exchangeRefreshToken(decryptTenantMollieOAuthToken(connection.refreshTokenCiphertext));
      const accessTokenCiphertext = encryptTenantMollieOAuthToken(token.access_token!);
      const refreshTokenCiphertext = token.refresh_token ? encryptTenantMollieOAuthToken(token.refresh_token) : connection.refreshTokenCiphertext;
      const nextScopes = token.scope?.split(/\s+/).filter(Boolean) ?? connection.grantedScopes;
      if (!hasRequiredScopes(nextScopes)) throw new TenantMollieCredentialError("Tenant Mollie reconnect is required.");
      await tx.execute(sql`
        update tenant_mollie_connections set
          access_token_ciphertext = ${accessTokenCiphertext}, refresh_token_ciphertext = ${refreshTokenCiphertext},
          access_token_expires_at = ${new Date(Date.now() + Math.max(1, token.expires_in ?? 3600) * 1000).toISOString()},
          granted_scopes = ${JSON.stringify(nextScopes)}::jsonb, credential_version = credential_version + 1,
          last_refreshed_at = now(), failure_reason_code = null, updated_at = now()
        where id = ${connection.id}
      `);
      return token.access_token!;
    } catch (error) {
      await tx.execute(sql`
        update tenant_mollie_connections set status = 'revoked', refresh_token_ciphertext = null,
          access_token_ciphertext = null, access_token_expires_at = null, failure_reason_code = 'refresh_failed',
          revoked_at = now(), updated_at = now() where id = ${connection.id}
      `);
      throw error;
    }
  });
}

async function revokeMollieRefreshToken(refreshToken: string) {
  const config = getMollieConnectConfig();
  const basic = Buffer.from(`${config.MOLLIE_CONNECT_CLIENT_ID}:${config.MOLLIE_CONNECT_CLIENT_SECRET}`).toString("base64");
  await fetch("https://api.mollie.com/oauth2/tokens", {
    method: "DELETE",
    headers: { Accept: "application/json", Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token" }),
    cache: "no-store",
  });
}

export async function disconnectTenantMollieConnection(tenantId: string) {
  const resolvedTenantId = requireTenantId(tenantId);
  const connection = await getTenantMollieConnection(resolvedTenantId);
  if (connection?.refreshTokenCiphertext) {
    try {
      await revokeMollieRefreshToken(decryptTenantMollieOAuthToken(connection.refreshTokenCiphertext));
    } catch {
      // Local disconnection must still remove usable credentials.
    }
  }
  await getDb().execute(sql`
    update tenant_mollie_connections set status = 'disconnected', refresh_token_ciphertext = null,
      access_token_ciphertext = null, access_token_expires_at = null, disconnected_at = now(),
      failure_reason_code = 'disconnected', updated_at = now()
    where tenant_id = ${resolvedTenantId}
  `);
}

export async function selectTenantMollieProfile(input: {
  tenantId: string;
  profileId: string;
  profileName: string | null;
}) {
  if (!input.profileId.trim()) {
    throw new TenantMollieCredentialError("A Mollie profile must be selected.");
  }
  await getDb().execute(sql`
    update tenant_mollie_connections set status = 'connected', selected_profile_id = ${input.profileId},
      selected_profile_name = ${input.profileName}, failure_reason_code = null, last_verified_at = now(), updated_at = now()
    where tenant_id = ${requireTenantId(input.tenantId)}
      and status = 'incomplete'
      and refresh_token_ciphertext is not null
  `);
}

export async function listTenantMollieProfiles(tenantId: string) {
  const accessToken = await getTenantMollieOAuthAccessToken(tenantId);
  const response = await fetch("https://api.mollie.com/v2/profiles?limit=250", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new TenantMollieCredentialError("Mollie profiles could not be verified.");
  const body = (await response.json()) as { _embedded?: { profiles?: Array<{ id?: unknown; name?: unknown }> } };
  return (body._embedded?.profiles ?? []).flatMap((profile) =>
    typeof profile.id === "string" ? [{ id: profile.id, name: typeof profile.name === "string" ? profile.name : null }] : [],
  );
}

export async function getTenantMollieCapabilitySummary(tenantId: string) {
  try {
    const accessToken = await getTenantMollieOAuthAccessToken(tenantId);
    const response = await fetch("https://api.mollie.com/v2/capabilities", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return { state: "unavailable" as const, paymentReady: false };
    const body = (await response.json()) as { _embedded?: { capabilities?: Array<{ id?: unknown; status?: unknown }> } };
    const capabilities = body._embedded?.capabilities ?? [];
    const payments = capabilities.find((entry) => entry.id === "payments");
    const paymentReady = payments?.status === "enabled";
    return { state: paymentReady ? "ready" as const : "action_required" as const, paymentReady };
  } catch {
    return { state: "unavailable" as const, paymentReady: false };
  }
}

export async function getTenantMollieOrganizationSummary(tenantId: string) {
  try {
    const accessToken = await getTenantMollieOAuthAccessToken(tenantId);
    const response = await fetch("https://api.mollie.com/v2/organizations/me", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { id?: unknown; name?: unknown };
    if (typeof body.id !== "string") return null;
    const organization = { id: body.id, name: typeof body.name === "string" ? body.name : null };
    await getDb().execute(sql`
      update tenant_mollie_connections set organization_id = ${organization.id}, organization_name = ${organization.name},
        last_verified_at = now(), updated_at = now() where tenant_id = ${requireTenantId(tenantId)}
    `);
    return organization;
  } catch {
    return null;
  }
}

export type TenantMollieAuthentication =
  | { kind: "oauth"; connectionId: string; accessToken: string; profileId: string }
  | { kind: "api_key"; apiKey: string };

export async function resolveTenantMollieAuthentication(
  tenantId: string,
  mode: MollieMode,
): Promise<TenantMollieAuthentication> {
  const connection = await getTenantMollieConnection(tenantId);

  if (connection !== null) {
    if (
      connection.status !== "connected" ||
      !connection.selectedProfileId ||
      !hasRequiredScopes(connection.grantedScopes)
    ) {
      throw new TenantMollieCredentialError("Tenant Mollie reconnect is required.");
    }

    return {
      kind: "oauth",
      connectionId: connection.id,
      accessToken: await getTenantMollieOAuthAccessToken(tenantId),
      profileId: connection.selectedProfileId,
    };
  }

  const legacy = await getTenantMollieCredentials(tenantId, mode);
  if (legacy) {
    return { kind: "api_key", apiKey: legacy.apiKey };
  }

  throw new TenantMollieCredentialError("Tenant Mollie credentials are missing.");
}
