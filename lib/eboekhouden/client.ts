import "server-only";

import { ZodError } from "zod";

import {
  resolveTenantEboekhoudenConfig,
  TenantEboekhoudenCredentialError,
} from "@/lib/eboekhouden/tenant-credentials";
import type { EboekhoudenRelation } from "@/lib/eboekhouden/relation-mapping";

const EBOEKHOUDEN_API_BASE_URL = "https://api.e-boekhouden.nl";

type SessionCache = {
  expiresAt: number;
  token: string;
};

type RelationListResponse = {
  count?: number;
  items?: EboekhoudenRelation[];
};

export type EboekhoudenListResponse<T> = {
  count?: number;
  items?: T[];
};

export type EboekhoudenInvoiceTemplate = {
  active?: boolean | null;
  id: number;
  name?: string | null;
  type?: "A" | "E" | string | null;
};

export type EboekhoudenLedger = {
  category?: string | null;
  code?: string | null;
  description?: string | null;
  id: number;
  name?: string | null;
};

export type EboekhoudenInvoiceItemInput = {
  description: string;
  ledgerId: number;
  pricePerUnit: number;
  quantity?: number;
  vatCode: string;
};

export type EboekhoudenCreateInvoiceInput = {
  date: string;
  inExVat?: "EX" | "IN";
  items: EboekhoudenInvoiceItemInput[];
  print?: boolean;
  reference?: string;
  relationId: number;
  templateId: number;
  termOfPayment: number;
};

export type EboekhoudenInvoice = {
  date?: string | null;
  id?: number;
  invoiceNumber?: string | null;
  reference?: string | null;
  relationId?: number | null;
  number?: string | null;
  urlPdfFile?: string | null;
};

const sessionCacheByKey = new Map<string, SessionCache>();

export class EboekhoudenConfigError extends Error {
  constructor(message = "EBOEKHOUDEN_API_TOKEN is missing.") {
    super(message);
    this.name = "EboekhoudenConfigError";
  }
}

export class EboekhoudenApiError extends Error {
  code?: string;
  propertyName?: string;
  status: number;

  constructor(
    message: string,
    options: { code?: string; propertyName?: string; status: number },
  ) {
    super(message);
    this.name = "EboekhoudenApiError";
    this.code = options.code;
    this.propertyName = options.propertyName;
    this.status = options.status;
  }
}

async function getConfig(tenantId?: string) {
  try {
    if (!tenantId) {
      throw new TenantEboekhoudenCredentialError(
        "Explicit tenant context is required.",
      );
    }

    return await resolveTenantEboekhoudenConfig(tenantId);
  } catch (error) {
    if (
      error instanceof TenantEboekhoudenCredentialError ||
      error instanceof ZodError
    ) {
      throw new EboekhoudenConfigError(
        error instanceof Error ? error.message : undefined,
      );
    }

    throw error;
  }
}

function getSessionCacheKey(tenantId?: string) {
  if (!tenantId) {
    throw new EboekhoudenConfigError("Explicit tenant context is required.");
  }

  return tenantId;
}

async function parseError(response: Response) {
  let body: unknown = null;

  try {
    body = await response.json();
  } catch {
    // Ignore non-JSON error responses.
  }

  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : undefined;
    const propertyName =
      typeof record.propertyName === "string"
        ? record.propertyName
        : undefined;
    const traceId =
      typeof record.traceId === "string" ? record.traceId : undefined;
    const message =
      typeof record.message === "string"
        ? record.message
        : typeof record.title === "string"
          ? record.title
          : "e-Boekhouden request failed.";
    const details = [
      code ? `code ${code}` : null,
      propertyName ? `field ${propertyName}` : null,
      traceId ? `trace ${traceId}` : null,
    ].filter((value): value is string => value !== null);

    return new EboekhoudenApiError(
      details.length > 0 ? `${message} (${details.join(", ")})` : message,
      {
        code,
        propertyName,
        status: response.status,
      },
    );
  }

  return new EboekhoudenApiError("e-Boekhouden request failed.", {
    status: response.status,
  });
}

async function startSession(tenantId?: string) {
  if (!tenantId) {
    throw new EboekhoudenConfigError("Explicit tenant context is required.");
  }

  const config = await getConfig(tenantId);
  const response = await fetch(`${EBOEKHOUDEN_API_BASE_URL}/v1/session`, {
    body: JSON.stringify({
      accessToken: config.EBOEKHOUDEN_API_TOKEN,
      source: config.EBOEKHOUDEN_API_SOURCE,
    }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  const session = (await response.json()) as {
    expiresIn: number;
    token: string;
  };

  const cacheEntry = {
    expiresAt: Date.now() + Math.max(session.expiresIn - 30, 1) * 1000,
    token: session.token,
  };
  sessionCacheByKey.set(getSessionCacheKey(tenantId), cacheEntry);

  return cacheEntry.token;
}

async function getSessionToken(tenantId?: string) {
  if (!tenantId) {
    throw new EboekhoudenConfigError("Explicit tenant context is required.");
  }

  const cacheKey = getSessionCacheKey(tenantId);
  const sessionCache = sessionCacheByKey.get(cacheKey);

  if (sessionCache && sessionCache.expiresAt > Date.now()) {
    return sessionCache.token;
  }

  return startSession(tenantId);
}

async function requestEboekhouden<T>(
  path: string,
  options: RequestInit = {},
  tenantId: string,
): Promise<T> {
  const token = await getSessionToken(tenantId);
  const response = await fetch(`${EBOEKHOUDEN_API_BASE_URL}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
      Authorization: token,
    },
  });

  if (response.status === 401) {
    sessionCacheByKey.delete(getSessionCacheKey(tenantId));
    const retryToken = await getSessionToken(tenantId);
    const retryResponse = await fetch(`${EBOEKHOUDEN_API_BASE_URL}${path}`, {
      ...options,
      cache: "no-store",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
        Authorization: retryToken,
      },
    });

    if (!retryResponse.ok) {
      throw await parseError(retryResponse);
    }

    if (retryResponse.status === 204) {
      return undefined as T;
    }

    return retryResponse.json() as Promise<T>;
  }

  if (!response.ok) {
    throw await parseError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function appendFilter(
  params: URLSearchParams,
  key: string,
  value: string | undefined,
) {
  if (!value) {
    return;
  }

  params.set(key, value);
}

export async function listEboekhoudenRelations(options: {
  code?: string;
  contact?: string;
  email?: string;
  limit?: number;
  name?: string;
  offset?: number;
  tenantId: string;
}) {
  const params = new URLSearchParams();

  params.set("limit", String(Math.min(Math.max(options?.limit ?? 20, 1), 2000)));
  params.set("offset", String(Math.max(options?.offset ?? 0, 0)));
  appendFilter(params, "code", options?.code);
  appendFilter(params, "contact[like]", options?.contact);
  appendFilter(params, "email[like]", options?.email);
  appendFilter(params, "name[like]", options?.name);

  return requestEboekhouden<RelationListResponse>(
    `/v1/relation?${params.toString()}`,
    {},
    options.tenantId,
  );
}

export async function searchEboekhoudenRelations(options: {
  limit?: number;
  offset?: number;
  query?: string;
  tenantId: string;
}) {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const query = options.query?.trim();

  if (!query) {
    return listEboekhoudenRelations({ limit, offset, tenantId: options.tenantId });
  }

  const likeQuery = `%${query}%`;
  const responses = await Promise.all([
    listEboekhoudenRelations({ limit, name: likeQuery, offset: 0, tenantId: options.tenantId }),
    listEboekhoudenRelations({ contact: likeQuery, limit, offset: 0, tenantId: options.tenantId }),
    listEboekhoudenRelations({ email: likeQuery, limit, offset: 0, tenantId: options.tenantId }),
    listEboekhoudenRelations({ code: query, limit, offset: 0, tenantId: options.tenantId }),
  ]);
  const itemsById = new Map<number, NonNullable<RelationListResponse["items"]>[number]>();

  for (const response of responses) {
    for (const item of response.items ?? []) {
      itemsById.set(item.id, item);
    }
  }

  const items = Array.from(itemsById.values()).slice(offset, offset + limit);

  return {
    count: itemsById.size,
    items,
  } satisfies RelationListResponse;
}

export async function getEboekhoudenRelation(id: number, tenantId: string) {
  return requestEboekhouden<EboekhoudenRelation>(`/v1/relation/${id}`, {}, tenantId);
}

export async function listEboekhoudenInvoiceTemplates(options: {
  active?: boolean;
  limit?: number;
  offset?: number;
  tenantId: string;
  type?: "A" | "E";
}) {
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(Math.max(options?.limit ?? 100, 1), 2000)));
  params.set("offset", String(Math.max(options?.offset ?? 0, 0)));
  if (typeof options?.active === "boolean") {
    params.set("active", String(options.active));
  }
  if (options?.type) {
    params.set("type", options.type);
  }

  return requestEboekhouden<EboekhoudenListResponse<EboekhoudenInvoiceTemplate>>(
      `/v1/invoicetemplate?${params.toString()}`,
      {},
      options.tenantId,
  );
}

export async function listEboekhoudenLedgers(options: {
  limit?: number;
  offset?: number;
  tenantId: string;
}) {
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(Math.max(options?.limit ?? 2000, 1), 2000)));
  params.set("offset", String(Math.max(options?.offset ?? 0, 0)));

  return requestEboekhouden<EboekhoudenListResponse<EboekhoudenLedger>>(
      `/v1/ledger?${params.toString()}`,
      {},
      options.tenantId,
  );
}

export async function createEboekhoudenInvoice(
  payload: EboekhoudenCreateInvoiceInput,
  tenantId: string,
) {
  return requestEboekhouden<EboekhoudenInvoice>("/v1/invoice", {
    body: JSON.stringify(payload),
    method: "POST",
  }, tenantId);
}

export async function getEboekhoudenInvoice(id: number, tenantId: string) {
  return requestEboekhouden<EboekhoudenInvoice>(
    `/v1/invoice/${id}`,
    {},
    tenantId,
  );
}

export async function listEboekhoudenInvoices(options: {
  date?: string;
  invoiceNumber?: string;
  limit?: number;
  offset?: number;
  relationId?: number;
  tenantId: string;
}) {
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(Math.max(options?.limit ?? 100, 1), 2000)));
  params.set("offset", String(Math.max(options?.offset ?? 0, 0)));
  if (options?.invoiceNumber) {
    params.set("invoiceNumber", options.invoiceNumber);
  }
  if (typeof options?.relationId === "number") {
    params.set("relationId", String(options.relationId));
  }
  if (options?.date) {
    params.set("date", options.date);
  }

  return requestEboekhouden<EboekhoudenListResponse<EboekhoudenInvoice>>(
      `/v1/invoice?${params.toString()}`,
      {},
      options.tenantId,
  );
}

export async function createEboekhoudenRelation(
  payload: Record<string, unknown>,
  tenantId: string,
) {
  return requestEboekhouden<{ id?: number } | EboekhoudenRelation>(
    "/v1/relation",
    {
      body: JSON.stringify(payload),
      method: "POST",
    },
    tenantId,
  );
}

export async function updateEboekhoudenRelation(
  id: number,
  payload: Record<string, unknown>,
  tenantId: string,
) {
  await requestEboekhouden<void>(`/v1/relation/${id}`, {
    body: JSON.stringify(payload),
    method: "PATCH",
  }, tenantId);
}

export function toPublicEboekhoudenError(error: unknown) {
  if (error instanceof EboekhoudenConfigError) {
    return {
      code: "missing_config",
      message: error.message,
      status: 503,
    };
  }

  if (error instanceof EboekhoudenApiError) {
    return {
      code: error.code ?? "api_error",
      message: error.message,
      propertyName: error.propertyName,
      status: error.status,
    };
  }

  return {
    code: "unknown_error",
    message: "Could not reach e-Boekhouden.",
    status: 502,
  };
}
