import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { getTenantMollieRequestAuthentication } from "@/lib/mollie/client";
import { type InvoiceProviderAdapter } from "@/lib/invoicing/provider-types";

type MollieRecipientProfile = {
  address: string | null;
  businessName: string | null;
  email: string;
  fullName: string | null;
  locale: string | null;
  phone: string | null;
};

class MollieSalesInvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MollieSalesInvoiceError";
  }
}

function toMollieLocale(locale: string | null | undefined) {
  switch (locale) {
    case "en_US":
      return "en_US";
    case "de_DE":
      return "de_DE";
    default:
      return "nl_NL";
  }
}

async function getRecipientProfile(
  customerId: string | null,
  tenantId: string,
): Promise<MollieRecipientProfile | null> {
  if (!customerId) {
    return null;
  }

  const result = await getDb().execute<MollieRecipientProfile>(sql`
    select
      nullif(c.metadata ->> 'address', '') as address,
      coalesce(nullif(c.metadata ->> 'businessName', ''), c.full_name) as "businessName",
      c.email,
      c.full_name as "fullName",
      c.locale,
      nullif(c.metadata ->> 'phone', '') as phone
    from customers c
    where c.id = ${customerId}
      and c.tenant_id = ${tenantId}
    limit 1
  `);

  return result.rows[0] ?? null;
}

function buildMollieRecipient(input: {
  customer: {
    address: string | null;
    email: string | null;
    locale: string | null;
    name: string | null;
    phone: string | null;
  };
  profile: MollieRecipientProfile | null;
}) {
  const email = input.customer.email ?? input.profile?.email ?? null;
  if (!email) {
    throw new MollieSalesInvoiceError(
      "Customer email is required for Mollie invoice creation.",
    );
  }

  const organizationName =
    input.profile?.businessName ?? input.customer.name ?? "Customer";
  const displayName = input.customer.name ?? input.profile?.fullName ?? organizationName;
  const addressLine = input.profile?.address ?? input.customer.address ?? "";

  return {
    recipientIdentifier: email,
    recipient: {
      city: "Unknown",
      country: "NL",
      email,
      locale: toMollieLocale(input.customer.locale ?? input.profile?.locale),
      organizationName,
      phone: input.customer.phone ?? input.profile?.phone ?? undefined,
      streetAndNumber: addressLine || "Unknown",
      type: "consumer",
      givenName: displayName,
      postalCode: "0000AA",
    },
  };
}

function buildMolliePayload(input: {
  amountCurrency: string;
  amountValue: string;
  customer: {
    address: string | null;
    email: string | null;
    id: string | null;
    locale: string | null;
    name: string | null;
    phone: string | null;
  };
  description: string;
  invoiceDate: string;
  plannedCollectionDate?: string | null;
  profile: MollieRecipientProfile | null;
  tenantId: string;
}) {
  const recipient = buildMollieRecipient({
    customer: input.customer,
    profile: input.profile,
  });

  return {
    lines: [
      {
        description: input.description,
        quantity: 1,
        unitPrice: {
          currency: input.amountCurrency,
          value: input.amountValue,
        },
        vatRate: "21.00",
      },
    ],
    memo: input.plannedCollectionDate
      ? `Planned collection date: ${input.plannedCollectionDate}. Source date: ${input.invoiceDate}.`
      : `Created by tenant ${input.tenantId} on ${input.invoiceDate}.`,
    paymentTerm: "30 days",
    ...recipient,
    status: "draft",
    vatMode: "exclusive",
    vatScheme: "standard",
  };
}

function extractDocumentUrl(record: Record<string, unknown>) {
  const links = record._links;
  if (!links || typeof links !== "object" || Array.isArray(links)) {
    return null;
  }

  const linkRecord = links as Record<string, unknown>;
  const candidates = ["pdf", "document", "dashboard", "self", "webView"];
  for (const key of candidates) {
    const value = linkRecord[key];
    if (
      value &&
      typeof value === "object" &&
      "href" in value &&
      typeof (value as { href?: unknown }).href === "string"
    ) {
      return (value as { href: string }).href;
    }
  }

  return null;
}

function extractInvoiceNumber(record: Record<string, unknown>) {
  const candidates = ["reference", "invoiceNumber", "number"];
  for (const key of candidates) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

async function requestMollieSalesInvoices<T>(
  input: {
    body?: Record<string, unknown>;
    method: "GET" | "POST";
    mode: "live" | "test";
    path: string;
    tenantId: string;
  },
) {
  const authentication = await getTenantMollieRequestAuthentication(input.tenantId, input.mode);
  const url = new URL(`https://api.mollie.com/v2${input.path}`);
  const isOAuth = authentication.kind === "oauth";
  const testmode = isOAuth && input.mode === "test";
  if (!input.body && testmode) {
    url.searchParams.set("testmode", "true");
  }
  const body = input.body
    ? {
        ...input.body,
        ...(isOAuth ? { profileId: authentication.profileId } : {}),
        ...(testmode ? { testmode: true } : {}),
      }
    : undefined;
  const response = await fetch(url, {
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${authentication.kind === "oauth" ? authentication.accessToken : authentication.apiKey}`,
      ...(input.body ? { "Content-Type": "application/json" } : {}),
    },
    method: input.method,
  });

  if (!response.ok) {
    let message = "Mollie Sales Invoice API request failed.";
    try {
      const errorBody = (await response.json()) as Record<string, unknown>;
      if (typeof errorBody.detail === "string") {
        message = errorBody.detail;
      } else if (typeof errorBody.title === "string") {
        message = errorBody.title;
      } else if (typeof errorBody.error === "string") {
        message = errorBody.error;
      } else if (typeof errorBody.message === "string") {
        message = errorBody.message;
      }
    } catch {
      // Ignore non-JSON error bodies.
    }

    throw new MollieSalesInvoiceError(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function validateMollieSalesInvoicesAccess(input: {
  mode: "live" | "test";
  tenantId: string;
}) {
  await requestMollieSalesInvoices<Record<string, unknown>>({
    method: "GET",
    mode: input.mode,
    path: "/sales-invoices?limit=1",
    tenantId: input.tenantId,
  });
}

export const mollieInvoiceProvider: InvoiceProviderAdapter = {
  async createInvoice(input) {
    const profile = await getRecipientProfile(input.customer.id, input.tenantId);
    const payload = buildMolliePayload({
      amountCurrency: input.amountCurrency,
      amountValue: input.amountValue,
      customer: input.customer,
      description: input.description,
      invoiceDate: input.invoiceDate,
      plannedCollectionDate: input.plannedCollectionDate,
      profile,
      tenantId: input.tenantId,
    });
    const invoice = await requestMollieSalesInvoices<Record<string, unknown>>({
      body: payload,
      method: "POST",
      mode: input.mode,
      path: "/sales-invoices",
      tenantId: input.tenantId,
    });

    return {
      provider: "mollie",
      providerCustomerId: null,
      providerDocumentUrl: extractDocumentUrl(invoice),
      providerInvoiceId:
        typeof invoice.id === "string" && invoice.id.trim() ? invoice.id : null,
      providerInvoiceNumber: extractInvoiceNumber(invoice),
      providerSnapshot: invoice,
    };
  },

  getCapabilities() {
    return {
      requiresCustomerLink: false,
      supportsExistingInvoiceLookup: false,
    };
  },

  getDisplayMetadata() {
    return {
      providerLabel: "Mollie",
    };
  },

  async getInvoiceDocument(input) {
    if (input.invoice.providerDocumentUrl) {
      return input.invoice.providerDocumentUrl;
    }

    if (!input.invoice.providerInvoiceId) {
      return null;
    }

    const invoice = await requestMollieSalesInvoices<Record<string, unknown>>({
      method: "GET",
      mode: input.invoice.mode,
      path: `/sales-invoices/${input.invoice.providerInvoiceId}`,
      tenantId: input.tenantId,
    });

    return extractDocumentUrl(invoice);
  },

  async validateTenantSetup(input) {
    try {
      await validateMollieSalesInvoicesAccess({
        mode: input.mode,
        tenantId: input.tenantId,
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof Error
            ? error.message
            : "Tenant Mollie credentials are missing.",
      };
    }
  },
};
