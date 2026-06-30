import process from "node:process";

import { ensureTenantBillingSettings } from "@/lib/billing-settings";
import { upsertTenantEboekhoudenCredentials } from "@/lib/eboekhouden/tenant-credentials";
import { ensureTenantSubscriptionPolicyDefaults } from "@/lib/subscription-policy-defaults";
import { provisionTenant } from "@/lib/tenants";

type CliArgs = {
  eboekhoudenApiSource: string | null;
  eboekhoudenApiToken: string | null;
  name: string;
  operatorEmail: string | null;
  platformOperatorEmail: string | null;
  slug: string;
  tenantId: string | null;
};

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
      "Usage: npm run tenant:provision -- --slug <slug> --name <name> [--operator-email <email>] [--platform-operator-email <email>] [--tenant-id <id>] [--eboekhouden-api-token <token>] [--eboekhouden-api-source <source>]",
    );
  }

  return {
    eboekhoudenApiSource: readFlag(args, "eboekhouden-api-source"),
    eboekhoudenApiToken: readFlag(args, "eboekhouden-api-token"),
    name,
    operatorEmail: readFlag(args, "operator-email"),
    platformOperatorEmail: readFlag(args, "platform-operator-email"),
    slug,
    tenantId: readFlag(args, "tenant-id"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
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

  console.log(
    JSON.stringify(
      {
        hasEboekhoudenCredentials: Boolean(args.eboekhoudenApiToken),
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
