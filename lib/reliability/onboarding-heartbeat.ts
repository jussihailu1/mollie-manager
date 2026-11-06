import type { CronIssue } from "./cron-issue-summary";

export function onboardingHeartbeatIssues(input: {
  tenantId: string;
  tenantName: string;
  lastScheduledSuccessAt: string | null;
  now?: number;
}): CronIssue[] {
  const age = (input.now ?? Date.now()) - Date.parse(input.lastScheduledSuccessAt ?? "");
  if (Number.isFinite(age) && age >= 0 && age <= 60 * 60_000) return [];
  return [{ tenantId: input.tenantId, tenantName: input.tenantName, count: 1,
    stage: "No successful scheduled onboarding recovery in the last hour; check the GitHub schedule, credentials and workflow status. Daily recovery remains the backup." }];
}
