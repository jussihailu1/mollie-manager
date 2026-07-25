import { buildDrawerPath } from "@/lib/dashboard-drawer-route";

export function buildConsentLinkUrl(token: string, baseUrl: string) {
  return new URL(`/subscribe/${token}`, baseUrl).toString();
}

export function buildConsentLinkReturnTo(input: {
  customerId: string;
  search: string;
}) {
  return buildDrawerPath("customers", input.customerId, input.search);
}
