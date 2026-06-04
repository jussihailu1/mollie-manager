export function buildConsentLinkCreatedNotice() {
  return "First payment consent link created. Open the customer drawer to copy the hosted link.";
}

export function buildConsentLinkUrl(token: string, baseUrl: string) {
  return new URL(`/subscribe/${token}`, baseUrl).toString();
}

export function buildConsentLinkReturnTo(input: {
  customerId: string;
  pathname: string;
  search: string;
}) {
  const params = new URLSearchParams(input.search);
  params.set("focus", input.customerId);

  const search = params.toString();
  return search ? `${input.pathname}?${search}` : input.pathname;
}
