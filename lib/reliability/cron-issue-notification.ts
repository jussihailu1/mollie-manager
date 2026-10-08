import "server-only";

import { writeAuditLog } from "@/lib/audit";
import { env } from "@/lib/env";
import { sendOperatorEmailOnce } from "@/lib/notifications/email";
import { sendCronIssueSummary, type CronIssueNotification } from "./cron-issue-summary";

export async function notifyCronIssues(input: Omit<CronIssueNotification, "appUrl">) {
  return sendCronIssueSummary({ ...input, appUrl: env.APP_URL }, {
    send: sendOperatorEmailOnce,
    record: async (outcome) => {
      await writeAuditLog({
        action: "cron.issue_notification",
        details: { issueCount: input.issues.length, issues: input.issues, runId: input.runId },
        entityId: input.runId,
        entityType: "cron_run",
        mode: input.mode,
        outcome,
        summary: outcome === "success" ? "Sent cron issue summary to the configured operator mailbox." : "Could not send cron issue summary; check SMTP configuration and delivery.",
      }, undefined, { kind: "system" });
    },
    reportFailure: () => {
      console.error("Kify cron issue notification or its delivery audit failed.", { runId: input.runId, mode: input.mode });
    },
  });
}
