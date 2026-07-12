import process from "node:process";

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type CliArgs = {
  eboekhoudenApiSource: string | null;
  eboekhoudenApiToken: string | null;
  mollieApiKey: string | null;
  mollieMode: "test" | "live" | null;
  name: string;
  operatorEmail: string | null;
  platformOperatorEmail: string | null;
  slug: string;
  tenantId: string | null;
};

function assertTenantCredentialEncryptionConfigured(
  args: CliArgs,
  appEncryptionKey: string | null | undefined,
) {
  if (!args.eboekhoudenApiToken && !args.mollieApiKey) {
    return;
  }

  if (!appEncryptionKey) {
    throw new Error(
      "APP_ENCRYPTION_KEY is required before provisioning tenant provider credentials.",
    );
  }
}

function readFlag(args: string[], name: string) {
  const index = args.findIndex((value) => value === `--${name}`);

  if (index === -1) {
    return null;
  }

  return args[index + 1] ?? null;
}

function parseArgs(args: string[]): CliArgs {
  const slug = readFlag(args, "slug");
  const name = readFlag(args, "name");

  if (!slug || !name) {
    throw new Error(
      "Usage: npm run tenant:provision -- --slug <slug> --name <name> [--operator-email <email>] [--platform-operator-email <email>] [--tenant-id <id>] [--eboekhouden-api-token <token>] [--eboekhouden-api-source <source>] [--mollie-api-key <key>] [--mollie-mode <test|live>]",
    );
  }

  return {
    eboekhoudenApiSource: readFlag(args, "eboekhouden-api-source"),
    eboekhoudenApiToken: readFlag(args, "eboekhouden-api-token"),
    mollieApiKey: readFlag(args, "mollie-api-key"),
    mollieMode:
      (readFlag(args, "mollie-mode") as CliArgs["mollieMode"]) ?? null,
    name,
    operatorEmail: readFlag(args, "operator-email"),
    platformOperatorEmail: readFlag(args, "platform-operator-email"),
    slug,
    tenantId: readFlag(args, "tenant-id"),
  };
}

async function main() {
  const [
    { ensureTenantBillingSettings },
    { env },
    { upsertTenantEboekhoudenCredentials },
    { getDefaultMollieMode },
    { upsertTenantMollieCredentials },
    { ensureTenantSubscriptionPolicyDefaults },
    { provisionTenant },
  ] = await Promise.all([
    import("@/lib/billing-settings"),
    import("@/lib/env"),
    import("@/lib/eboekhouden/tenant-credentials"),
    import("@/lib/mollie/client"),
    import("@/lib/mollie/tenant-credentials"),
    import("@/lib/subscription-policy-defaults"),
    import("@/lib/tenants"),
  ]);

  const args = parseArgs(process.argv.slice(2));
  assertTenantCredentialEncryptionConfigured(args, env.APP_ENCRYPTION_KEY);
  const tenantId = await provisionTenant({
    name: args.name,
    operatorEmail: args.operatorEmail,
    platformOperatorEmail: args.platformOperatorEmail,
    slug: args.slug,
    tenantId: args.tenantId ?? undefined,
  });

  await ensureTenantSubscriptionPolicyDefaults(tenantId);
  await ensureTenantBillingSettings(tenantId);

  if (args.eboekhoudenApiToken) {
    await upsertTenantEboekhoudenCredentials(
      {
        apiSource: args.eboekhoudenApiSource ?? "Kify",
        apiToken: args.eboekhoudenApiToken,
      },
      tenantId,
    );
  }

  if (args.mollieApiKey) {
    await upsertTenantMollieCredentials(
      {
        apiKey: args.mollieApiKey,
        mode: args.mollieMode ?? getDefaultMollieMode(),
      },
      tenantId,
    );
  }

  console.log(
    JSON.stringify(
      {
        hasEboekhoudenCredentials: Boolean(args.eboekhoudenApiToken),
        hasMollieCredentials: Boolean(args.mollieApiKey),
        mollieMode: args.mollieApiKey
          ? args.mollieMode ?? getDefaultMollieMode()
          : null,
        name: args.name,
        operatorEmail: args.operatorEmail,
        platformOperatorEmail: args.platformOperatorEmail,
        slug: args.slug,
        tenantId,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Tenant provisioning failed.",
  );
  process.exit(1);
});
