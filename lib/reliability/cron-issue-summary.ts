export type CronIssue = {
  tenantId: string | null;
  tenantName: string;
  stage: string;
  count: number;
};

type CronStageResults = {
  failedStages?: string[];
  tenantId: string;
  tenantName: string;
  paymentDiscovery: { failedCount: number };
  webhookRepairResult: { failedCount: number };
  staleRepairResult: { failedCount: number };
  activationJobs: { exhaustedCount: number; retriedCount: number };
  activationNotifications: { failedCount: number };
  firstPaymentCreateResult: { failedCount: number };
  recurringCreateResult: { failedCount: number };
  firstPaymentDeliveryRetry: { failedCount: number };
  recurringDeliveryRetry: { failedCount: number };
  failedFirstPaymentRecoveryResult: { ambiguousCount: number; verificationFailedCount: number };
  failedRecurringRecoveryResult: { ambiguousCount: number; verificationFailedCount: number };
};

export function collectCronIssues(result: CronStageResults): CronIssue[] {
  const counts: [string, number][] = [
    ["Payment discovery failed", result.paymentDiscovery.failedCount],
    ["Webhook repair failed", result.webhookRepairResult.failedCount],
    ["Stale-record repair failed", result.staleRepairResult.failedCount],
    ["Subscription activation needs another retry", result.activationJobs.retriedCount],
    ["Subscription activation exhausted retries", result.activationJobs.exhaustedCount],
    ["Activation notification delivery failed", result.activationNotifications.failedCount],
    ["First-payment invoice creation failed", result.firstPaymentCreateResult.failedCount],
    ["Recurring invoice creation failed", result.recurringCreateResult.failedCount],
    ["First-payment invoice delivery failed", result.firstPaymentDeliveryRetry.failedCount],
    ["Recurring invoice delivery failed", result.recurringDeliveryRetry.failedCount],
    ["First-payment invoice recovery is ambiguous", result.failedFirstPaymentRecoveryResult.ambiguousCount],
    ["First-payment invoice verification failed", result.failedFirstPaymentRecoveryResult.verificationFailedCount],
    ["Recurring invoice recovery is ambiguous", result.failedRecurringRecoveryResult.ambiguousCount],
    ["Recurring invoice verification failed", result.failedRecurringRecoveryResult.verificationFailedCount],
  ];
  const issues = counts.filter(([, count]) => count > 0).map(([stage, count]) => ({
    tenantId: result.tenantId, tenantName: result.tenantName, stage, count,
  }));
  for (const stage of result.failedStages ?? []) {
    issues.push({ tenantId: result.tenantId, tenantName: result.tenantName, stage: `Stage did not complete: ${stage}; inspect audit/runtime logs before retrying`, count: 1 });
  }
  return issues;
}

export type CronIssueNotification = {
  issues: CronIssue[];
  mode: "test" | "live";
  runId: string;
  appUrl: string;
};

export async function sendCronIssueSummary(
  input: CronIssueNotification,
  dependencies: {
    send: (message: { subject: string; text: string }) => Promise<void>;
    record: (outcome: "success" | "failure") => Promise<void>;
    reportFailure: () => void;
  },
) {
  if (input.issues.length === 0) return "skipped" as const;
  let delivered = false;
  try {
    // Only allowlisted stage descriptions and internal tenant identifiers enter
    // email. Never include exception messages, provider payloads or customer data.
    const lines = input.issues.map((issue) =>
      `- ${issue.tenantName.replace(/[\r\n]/g, " ")} (${issue.tenantId ?? "platform"}): ${issue.stage} (${issue.count})`,
    );
    await dependencies.send({
      subject: `[Kify] ${input.mode.toUpperCase()} cron needs attention`,
      text: [
        "Kify detected unresolved issues during its scheduled billing/recovery run.",
        `Run: ${input.runId}`,
        `Mode: ${input.mode}`,
        "",
        ...lines,
        "",
        "Other work may have completed successfully. Check the audit history before retrying; do not blindly recreate invoices or charges.",
        `Open Kify settings: ${new URL("/settings", input.appUrl).toString()}`,
        "Select the named workspace and mode when reviewing its activity.",
        "This summary covers this run only. An aborted run may not have reached every stage.",
      ].join("\n"),
    });
    delivered = true;
    await dependencies.record("success");
    return "sent" as const;
  } catch {
    // Email/audit outages must not cause billing to be replayed or recursively
    // generate emails. A failed audit after sending is not a failed send.
    try { dependencies.reportFailure(); } catch { /* Logging must not fail billing. */ }
    if (!delivered) {
      try { await dependencies.record("failure"); } catch { /* Runtime log is the fallback. */ }
    }
    return delivered ? "sent_audit_failed" as const : "failed" as const;
  }
}
