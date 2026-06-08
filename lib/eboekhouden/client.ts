import "server-only";

import { getEboekhoudenConfig } from "@/lib/env";
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

let sessionCache: SessionCache | null = null;

export class EboekhoudenConfigError extends Error {
  constructor() {
    super("EBOEKHOUDEN_API_TOKEN is missing.");
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

function getConfig() {
  try {
    return getEboekhoudenConfig();
  } catch {
    throw new EboekhoudenConfigError();
  }
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

async function startSession() {
  const config = getConfig();
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

  sessionCache = {
    expiresAt: Date.now() + Math.max(session.expiresIn - 30, 1) * 1000,
    token: session.token,
  };

  return sessionCache.token;
}

async function getSessionToken() {
  if (sessionCache && sessionCache.expiresAt > Date.now()) {
    return sessionCache.token;
  }

  return startSession();
}

async function requestEboekhouden<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getSessionToken();
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
    sessionCache = null;
    const retryToken = await getSessionToken();
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

export async function listEboekhoudenRelations(options?: {
  code?: string;
  contact?: string;
  email?: string;
  limit?: number;
  name?: string;
  offset?: number;
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
  );
}

export async function searchEboekhoudenRelations(options: {
  limit?: number;
  offset?: number;
  query?: string;
}) {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const query = options.query?.trim();

  if (!query) {
    return listEboekhoudenRelations({ limit, offset });
  }

  const likeQuery = `%${query}%`;
  const responses = await Promise.all([
    listEboekhoudenRelations({ limit, name: likeQuery, offset: 0 }),
    listEboekhoudenRelations({ contact: likeQuery, limit, offset: 0 }),
    listEboekhoudenRelations({ email: likeQuery, limit, offset: 0 }),
    listEboekhoudenRelations({ code: query, limit, offset: 0 }),
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

export async function getEboekhoudenRelation(id: number) {
  return requestEboekhouden<EboekhoudenRelation>(`/v1/relation/${id}`);
}

export async function listEboekhoudenInvoiceTemplates(options?: {
  active?: boolean;
  limit?: number;
  offset?: number;
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
  );
}

export async function listEboekhoudenLedgers(options?: {
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(Math.max(options?.limit ?? 2000, 1), 2000)));
  params.set("offset", String(Math.max(options?.offset ?? 0, 0)));

  return requestEboekhouden<EboekhoudenListResponse<EboekhoudenLedger>>(
    `/v1/ledger?${params.toString()}`,
  );
}

export async function createEboekhoudenInvoice(
  payload: EboekhoudenCreateInvoiceInput,
) {
  return requestEboekhouden<EboekhoudenInvoice>("/v1/invoice", {
    body: JSON.stringify(payload),
    method: "POST",
  });
}

export async function getEboekhoudenInvoice(id: number) {
  return requestEboekhouden<EboekhoudenInvoice>(`/v1/invoice/${id}`);
}

export async function listEboekhoudenInvoices(options?: {
  date?: string;
  invoiceNumber?: string;
  limit?: number;
  offset?: number;
  relationId?: number;
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
  );
}

export async function createEboekhoudenRelation(
  payload: Record<string, unknown>,
) {
  return requestEboekhouden<{ id?: number } | EboekhoudenRelation>(
    "/v1/relation",
    {
      body: JSON.stringify(payload),
      method: "POST",
    },
  );
}

export async function updateEboekhoudenRelation(
  id: number,
  payload: Record<string, unknown>,
) {
  await requestEboekhouden<void>(`/v1/relation/${id}`, {
    body: JSON.stringify(payload),
    method: "PATCH",
  });
}

export function toPublicEboekhoudenError(error: unknown) {
  if (error instanceof EboekhoudenConfigError) {
    return {
      code: "missing_config",
      message:
        "EBOEKHOUDEN_API_TOKEN is missing. Add it to the server environment before importing relations.",
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
