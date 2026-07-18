import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const source = (path: string) => readFileSync(resolve(path), "utf8");

describe("Mollie Connect OAuth lifecycle scope", () => {
  const oauthStateSource = source("lib/mollie/oauth-state.ts");
  const connectionSource = source("lib/mollie/tenant-connections.ts");
  const connectRouteSource = source("app/api/mollie/connect/route.ts");
  const callbackRouteSource = source("app/mollie/connect/callback/route.ts");
  const disconnectRouteSource = source("app/api/mollie/connect/disconnect/route.ts");

  it("persists only a digest and consumes OAuth state once for the bound actor", () => {
    assert.match(oauthStateSource, /randomBytes\(32\)\.toString\("base64url"\)/);
    assert.match(oauthStateSource, /createHash\("sha256"\)\.update\(state\)\.digest\("hex"\)/);
    assert.match(oauthStateSource, /insert into mollie_oauth_states \(id, state_digest, tenant_id, actor_email, expires_at\)/);
    assert.match(oauthStateSource, /\$\{digest\(state\)\}, \$\{input\.tenantId\}, \$\{input\.actorEmail\.toLowerCase\(\)\}/);
    assert.doesNotMatch(oauthStateSource, /insert into mollie_oauth_states[\s\S]{0,400}\$\{state\}/);
    assert.match(oauthStateSource, /actor_email = \$\{actorEmail\}/);
    assert.match(oauthStateSource, /consumed_at is null/);
    assert.match(oauthStateSource, /expires_at > now\(\)/);
    assert.match(oauthStateSource, /set consumed_at = now\(\)/);
  });

  it("requests and enforces the complete Connect scope contract", () => {
    for (const scope of [
      "organizations.read", "profiles.read", "onboarding.read", "customers.read",
      "customers.write", "payments.read", "payments.write", "payment-links.read",
      "payment-links.write", "mandates.read", "mandates.write", "subscriptions.read",
      "subscriptions.write", "sales-invoices.read", "sales-invoices.write",
    ]) {
      assert.match(connectionSource, new RegExp(`"${scope.replace(".", "\\.")}"`));
    }
    assert.doesNotMatch(connectionSource, /"invoices\.(?:read|write)"/);
    assert.match(connectRouteSource, /url\.searchParams\.set\("scope", REQUIRED_MOLLIE_CONNECT_SCOPES\.join\(" "\)\)/);
    assert.match(callbackRouteSource, /REQUIRED_MOLLIE_CONNECT_SCOPES\.every\(\(scope\) => grantedScopes\.includes\(scope\)\)/);
    assert.match(connectionSource, /REQUIRED_MOLLIE_CONNECT_SCOPES\.every\(\(scope\) => granted\.has\(scope\)\)/);
    assert.match(connectionSource, /if \(!hasRequiredScopes\(nextScopes\)\) throw new TenantMollieCredentialError\("Tenant Mollie reconnect is required\."\)/);
    assert.match(callbackRouteSource, /const profiles = await listTenantMollieProfiles\(tenantId\)/);
    assert.match(callbackRouteSource, /if \(profiles\.length === 1\)/);
    assert.match(callbackRouteSource, /await selectTenantMollieProfile\(\{[\s\S]*profileId: profile\.id/);
  });

  it("does not place OAuth codes, tokens, or provider response bodies in callback redirects", () => {
    assert.match(callbackRouteSource, /function resultUrl\(result: string\)/);
    assert.match(callbackRouteSource, /new URL\(`\/settings\?mollieConnect=\$\{result\}`/);
    assert.match(callbackRouteSource, /NextResponse\.redirect\(resultUrl\("(?:cancelled|failed|profile_required|scope_required)"\)\)/);
    assert.doesNotMatch(callbackRouteSource, /resultUrl\((?:code|state|token|response)/);
    assert.doesNotMatch(callbackRouteSource, /NextResponse\.redirect\([^\n]*(?:code|state|access_token|refresh_token)/);
    assert.doesNotMatch(callbackRouteSource, /console\.(?:log|error|warn)/);
    assert.doesNotMatch(callbackRouteSource, /JSON\.stringify\(token\)/);
  });

  it("serializes refreshes, rotates encrypted credentials, and revokes unusable connections", () => {
    assert.match(connectionSource, /return transaction\(async \(tx\) => \{[\s\S]*from tenant_mollie_connections where tenant_id = \$\{resolvedTenantId\} for update/);
    assert.match(connectionSource, /const refreshTokenCiphertext = token\.refresh_token \? encryptTenantMollieOAuthToken\(token\.refresh_token\) : connection\.refreshTokenCiphertext/);
    assert.match(connectionSource, /credential_version = credential_version \+ 1/);
    assert.match(connectionSource, /last_refreshed_at = now\(\)/);
    assert.match(connectionSource, /catch \(error\) \{[\s\S]*status = 'revoked', refresh_token_ciphertext = null,[\s\S]*access_token_ciphertext = null/);
    assert.match(connectionSource, /failure_reason_code = 'refresh_failed'/);
  });

  it("revokes remotely when possible, always clears local credentials, and writes a safe disconnect audit", () => {
    assert.match(connectionSource, /method: "DELETE"/);
    assert.match(connectionSource, /token_type_hint: "refresh_token"/);
    assert.match(connectionSource, /catch \{[\s\S]*Local disconnection must still remove usable credentials\./);
    assert.match(connectionSource, /status = 'disconnected', refresh_token_ciphertext = null,[\s\S]*access_token_ciphertext = null,[\s\S]*access_token_expires_at = null/);
    assert.match(disconnectRouteSource, /writeAuditLog\(\{ action: "mollie\.connect\.disconnected"/);
    assert.match(disconnectRouteSource, /summary: "Mollie connection disconnected\."/);
    assert.doesNotMatch(disconnectRouteSource, /(?:accessToken|refreshToken|ciphertext|Authorization|MOLLIE_CONNECT_CLIENT_SECRET)/);
  });
});
