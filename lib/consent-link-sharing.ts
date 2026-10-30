import type { Metadata } from "next";

import { formatCurrency } from "@/lib/format";

export type ConsentLinkShareDetails = {
  issuerName: string | null;
  firstPaymentMode: "real_installment" | "mandate_only";
  firstPaymentAmountValue: string;
};

export function buildConsentShareMessage(input: ConsentLinkShareDetails & {
  recipientName: string;
  url: string;
}) {
  const subscription = input.issuerName?.trim()
    ? `your subscription with ${input.issuerName.trim()}`
    : "your subscription";
  const payment = input.firstPaymentMode === "mandate_only"
    ? `complete the ${formatCurrency(input.firstPaymentAmountValue)} setup payment to authorize future subscription payments`
    : `complete your first payment of ${formatCurrency(input.firstPaymentAmountValue)}`;

  return `Hi ${input.recipientName.trim() || "there"},\n\nPlease review and confirm ${subscription}, then ${payment} using the link below.\n\n${input.url}`;
}

// Keep the destination local and limited to the two consent-link entry points.
export function buildConsentShareReturnPath(returnTo: string, customerId: string) {
  const base = "https://consent-return.invalid";
  let url: URL;
  try {
    url = new URL(returnTo, base);
  } catch {
    url = new URL("/customers", base);
  }
  if (url.origin !== base || !/^\/(customers|payments)(\/[^/]+)?$/.test(url.pathname)) {
    url = new URL("/customers", base);
  }
  url.searchParams.delete("shareConsent");
  url.searchParams.set("shareConsent", customerId);
  return `${url.pathname}${url.search}`;
}

export function buildConsentPreviewMetadata(
  details: ConsentLinkShareDetails | null,
  imageUrl: string,
): Metadata {
  const issuerName = details?.issuerName?.trim();
  const title = !details
    ? "Subscription link unavailable"
    : issuerName ? `Your subscription with ${issuerName}` : "Confirm your subscription";
  const description = !details
    ? "This link is invalid or no longer available. Please ask the business for a new link."
    : details.firstPaymentMode === "mandate_only"
      ? "Review your subscription, confirm the terms, and complete a setup payment to authorize future subscription payments."
      : "Review your subscription, confirm the terms, and complete your first payment.";

  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      title,
      description,
      siteName: issuerName || "Subscription confirmation",
      images: [{ url: imageUrl, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}
