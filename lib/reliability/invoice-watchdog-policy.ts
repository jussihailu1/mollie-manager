export type InvoiceWatchdogSnapshot = {
  activeCount: number;
  lastSuccess: string | null;
  overdueCount: number;
  blockedCount: number;
  stalledCount: number;
  uncertainEmailCount: number;
};

export function invoiceWatchdogIssues(snapshot: InvoiceWatchdogSnapshot, now = Date.now()) {
  const issues: Array<{ key: string; message: string }> = [];
  const age = now - Date.parse(snapshot.lastSuccess ?? "");
  if (snapshot.activeCount > 0 && (!Number.isFinite(age) || age < 0 || age > 27 * 60 * 60_000)) issues.push({ key: "missed_run", message: "No successful daily invoice run within 27 hours. Check the invoice scheduler and runtime logs." });
  if (snapshot.overdueCount > 0) issues.push({ key: "overdue", message: `${snapshot.overdueCount} invoice(s) are past their send date and still not sent.` });
  if (snapshot.blockedCount > 0) issues.push({ key: "accounting_link", message: `${snapshot.blockedCount} due invoice(s) lack an accounting relation. Complete the customer invoice setup.` });
  if (snapshot.stalledCount > 0) issues.push({ key: "stalled_creation", message: `${snapshot.stalledCount} invoice creation claim(s) were interrupted. Scheduled recovery must reconcile the provider before retrying.` });
  if (snapshot.uncertainEmailCount > 0) issues.push({ key: "uncertain_email", message: `${snapshot.uncertainEmailCount} invoice email attempt(s) have uncertain acceptance. Automatic resend is held to prevent duplicate copies; verify delivery before releasing the attempt.` });
  return issues;
}
