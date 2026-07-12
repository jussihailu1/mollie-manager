const INVOICE_PDF_MAX_BYTES = 5 * 1024 * 1024;
const INVOICE_PDF_FETCH_TIMEOUT_MS = 10_000;
const INVOICE_PDF_MAX_REDIRECTS = 2;

const PDF_MAGIC_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];

type FetchLike = typeof fetch;

export type InvoicePdfAttachmentStatus =
  | "attached"
  | "download_failed"
  | "invalid_content_type"
  | "invalid_pdf"
  | "missing_url"
  | "timeout"
  | "too_large"
  | "untrusted_url";

export type InvoicePdfAttachment = {
  content: Buffer;
  contentType: "application/pdf";
  filename: string;
};

export function normalizeTrustedInvoicePdfUrl(
  rawUrl: string | null | undefined,
  baseUrl?: string,
) {
  if (!rawUrl || !rawUrl.trim()) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== "https:" ||
    !isTrustedInvoicePdfHost(parsed.hostname) ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }

  parsed.hash = "";
  return parsed.toString();
}

export async function buildTrustedInvoicePdfAttachment(input: {
  fetchImpl?: FetchLike;
  invoiceNumber: string;
  invoicePdfUrl: string | null;
}) {
  const trustedInvoicePdfUrl = normalizeTrustedInvoicePdfUrl(input.invoicePdfUrl);
  if (!input.invoicePdfUrl) {
    return {
      attachment: null,
      attachmentStatus: "missing_url" as const,
      trustedInvoicePdfUrl: null,
    };
  }

  if (!trustedInvoicePdfUrl) {
    return {
      attachment: null,
      attachmentStatus: "untrusted_url" as const,
      trustedInvoicePdfUrl: null,
    };
  }

  try {
    const response = await fetchTrustedInvoicePdfResponse({
      fetchImpl: input.fetchImpl ?? fetch,
      url: trustedInvoicePdfUrl,
    });

    if (!response.ok) {
      return {
        attachment: null,
        attachmentStatus: "download_failed" as const,
        trustedInvoicePdfUrl,
      };
    }

    const contentType = response.headers.get("content-type");
    if (contentType && !isPdfContentType(contentType)) {
      return {
        attachment: null,
        attachmentStatus: "invalid_content_type" as const,
        trustedInvoicePdfUrl,
      };
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const parsedLength = Number(contentLength);
      if (Number.isFinite(parsedLength) && parsedLength > INVOICE_PDF_MAX_BYTES) {
        return {
          attachment: null,
          attachmentStatus: "too_large" as const,
          trustedInvoicePdfUrl,
        };
      }
    }

    const bytes = await readResponseBytesWithinLimit(response, INVOICE_PDF_MAX_BYTES);
    if (!bytes) {
      return {
        attachment: null,
        attachmentStatus: "too_large" as const,
        trustedInvoicePdfUrl,
      };
    }

    if (!hasPdfSignature(bytes)) {
      return {
        attachment: null,
        attachmentStatus: "invalid_pdf" as const,
        trustedInvoicePdfUrl,
      };
    }

    return {
      attachment: {
        content: Buffer.from(bytes),
        contentType: "application/pdf" as const,
        filename: `factuur-${input.invoiceNumber}.pdf`,
      },
      attachmentStatus: "attached" as const,
      trustedInvoicePdfUrl,
    };
  } catch (error) {
    return {
      attachment: null,
      attachmentStatus: isAbortError(error) ? ("timeout" as const) : ("download_failed" as const),
      trustedInvoicePdfUrl,
    };
  }
}

function isTrustedInvoicePdfHost(hostname: string) {
  return (
    hostname === "e-boekhouden.nl" ||
    hostname.endsWith(".e-boekhouden.nl") ||
    hostname === "mollie.com" ||
    hostname.endsWith(".mollie.com")
  );
}

function isPdfContentType(contentType: string) {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    normalized === "application/pdf" || normalized === "application/octet-stream"
  );
}

function hasPdfSignature(bytes: Uint8Array) {
  return PDF_MAGIC_HEADER.every((value, index) => bytes[index] === value);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

async function fetchTrustedInvoicePdfResponse(input: {
  fetchImpl: FetchLike;
  url: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INVOICE_PDF_FETCH_TIMEOUT_MS);

  try {
    let currentUrl = input.url;

    for (let redirectCount = 0; redirectCount <= INVOICE_PDF_MAX_REDIRECTS; redirectCount += 1) {
      const response = await input.fetchImpl(currentUrl, {
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });

      if (!isRedirectResponse(response.status)) {
        return response;
      }

      const location = response.headers.get("location");
      const nextUrl = location
        ? normalizeTrustedInvoicePdfUrl(location, currentUrl)
        : null;
      if (!nextUrl) {
        return response;
      }

      currentUrl = nextUrl;
    }

    return new Response(null, { status: 310 });
  } finally {
    clearTimeout(timeout);
  }
}

function isRedirectResponse(status: number) {
  return status >= 300 && status < 400;
}

async function readResponseBytesWithinLimit(response: Response, maxBytes: number) {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
      return null;
    }

    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    return null;
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}
