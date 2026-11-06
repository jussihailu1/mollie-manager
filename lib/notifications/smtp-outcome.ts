// Retry only when SMTP positively rejected the message, or submission could
// not have begun. A timeout after DATA has an unknown acceptance outcome.
export function smtpDefinitelyDidNotAccept(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const detail = error as { code?: string; command?: string; responseCode?: number };
  if (detail.responseCode && detail.responseCode >= 400 && detail.responseCode <= 599) return true;
  if (detail.code === "EDNS" || detail.code === "EAUTH") return true;
  return ["CONN", "CONNECT", "EHLO", "HELO", "STARTTLS", "AUTH", "MAIL FROM", "RCPT TO"].includes(detail.command ?? "");
}

export const SMTP_TIMEOUTS = { connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000, dnsTimeout: 5000 };
