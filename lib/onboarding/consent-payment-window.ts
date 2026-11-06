import { addCalendarDays, DEFAULT_RECURRING_BILLING_POLICY } from "@/lib/recurring-billing-policy";

export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Stop checkout the day before the invoice is due. This leaves the daily
// invoice run plus one day of activation/settlement headroom, including DST.
export function consentPaymentExpiresAt(startDate: string, noticeDays = DEFAULT_RECURRING_BILLING_POLICY.invoiceNoticeDaysBeforeDueDate as number) {
  if (!isCalendarDate(startDate) || !Number.isInteger(noticeDays) || noticeDays < 0 || noticeDays > 365) throw new Error("Invalid subscription schedule.");
  const cutoffDate = addCalendarDays(startDate, -(noticeDays + 2));
  // 22:00 UTC is never later than the following Amsterdam midnight.
  return `${cutoffDate}T22:00:00.000Z`;
}

export function consentPaymentWindowIsOpen(startDate: string, noticeDays?: number, now = new Date()) {
  try { return now.getTime() < Date.parse(consentPaymentExpiresAt(startDate, noticeDays)); } catch { return false; }
}

export function requireConsentPaymentWindow(startDate: string, noticeDays?: number, now = new Date()) {
  if (!consentPaymentWindowIsOpen(startDate, noticeDays, now)) throw new Error("Choose a later subscription start date so payment and invoice delivery can finish before collection. Allow at least seven calendar days.");
  return consentPaymentExpiresAt(startDate, noticeDays);
}
