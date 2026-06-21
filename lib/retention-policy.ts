export type RetentionDataMode = "live" | "test";
export type RetentionReportMode = RetentionDataMode | "all";

export type RetentionDataArea =
  | "audit-core"
  | "audit-details"
  | "accepted-consent-core"
  | "accepted-consent-client-data"
  | "processed-webhook-payload"
  | "failed-webhook-payload"
  | "test-operational-data"
  | "generic-metadata";

export type RetentionAction =
  | "keep"
  | "redact-where-safe"
  | "delete-or-redact"
  | "delete-or-anonymize";

export type RetentionWindow =
  | { readonly kind: "days"; readonly days: number }
  | { readonly kind: "months"; readonly months: number }
  | { readonly kind: "years"; readonly years: number }
  | { readonly kind: "years-after-resolution"; readonly years: number }
  | {
      readonly kind: "subscription-lifetime-plus-years";
      readonly yearsAfterSubscription: number;
    };

export interface RetentionPolicyRecord {
  readonly dataArea: RetentionDataArea;
  readonly dataAreaLabel: string;
  readonly modes: readonly RetentionDataMode[];
  readonly window: RetentionWindow;
  readonly windowLabel: string;
  readonly action: RetentionAction;
  readonly actionLabel: string;
  readonly evidenceImpact: string;
}

export const RETENTION_WINDOWS = {
  auditCoreYears: 7,
  auditDetails: 180,
  acceptedConsentCoreAfterSubscriptionYears: 7,
  acceptedConsentClientDataMonths: 12,
  processedWebhookPayload: 180,
  failedWebhookPayloadAfterResolutionYears: 1,
  testOperationalData: 90,
  genericMetadata: 180,
} as const;

export const RETENTION_POLICY_VERSION = "2026-06-18";

const BOTH_MODES = ["live", "test"] as const;

export const RETENTION_POLICY: readonly RetentionPolicyRecord[] = [
  {
    dataArea: "audit-core",
    dataAreaLabel: "Audit core evidence",
    modes: BOTH_MODES,
    window: { kind: "years", years: RETENTION_WINDOWS.auditCoreYears },
    windowLabel: "7 years",
    action: "keep",
    actionLabel: "Keep operational and financial evidence",
    evidenceImpact: "Preserves audit, financial, and invoice evidence.",
  },
  {
    dataArea: "audit-details",
    dataAreaLabel: "Audit sensitive details",
    modes: BOTH_MODES,
    window: { kind: "days", days: RETENTION_WINDOWS.auditDetails },
    windowLabel: "180 days",
    action: "redact-where-safe",
    actionLabel: "Redact sensitive non-evidence details where safe",
    evidenceImpact: "Keeps the audit event while removing details that are not evidence.",
  },
  {
    dataArea: "accepted-consent-core",
    dataAreaLabel: "Accepted consent core evidence",
    modes: BOTH_MODES,
    window: {
      kind: "subscription-lifetime-plus-years",
      yearsAfterSubscription:
        RETENTION_WINDOWS.acceptedConsentCoreAfterSubscriptionYears,
    },
    windowLabel: "Subscription lifetime + 7 years",
    action: "keep",
    actionLabel: "Keep core consent evidence",
    evidenceImpact: "Preserves terms, checkbox, acceptance, plan, mandate, and authorization evidence.",
  },
  {
    dataArea: "accepted-consent-client-data",
    dataAreaLabel: "Accepted consent IP and user-agent",
    modes: BOTH_MODES,
    window: {
      kind: "months",
      months: RETENTION_WINDOWS.acceptedConsentClientDataMonths,
    },
    windowLabel: "12 months",
    action: "redact-where-safe",
    actionLabel: "Redact unless required as evidence",
    evidenceImpact: "Preserves values tied to disputes, fraud, security, or legal evidence.",
  },
  {
    dataArea: "processed-webhook-payload",
    dataAreaLabel: "Processed webhook raw payload",
    modes: BOTH_MODES,
    window: {
      kind: "days",
      days: RETENTION_WINDOWS.processedWebhookPayload,
    },
    windowLabel: "180 days",
    action: "delete-or-redact",
    actionLabel: "Delete or redact raw payload",
    evidenceImpact: "Keeps useful minimal normalized event facts.",
  },
  {
    dataArea: "failed-webhook-payload",
    dataAreaLabel: "Failed webhook raw payload",
    modes: BOTH_MODES,
    window: {
      kind: "years-after-resolution",
      years: RETENTION_WINDOWS.failedWebhookPayloadAfterResolutionYears,
    },
    windowLabel: "1 year after resolution",
    action: "delete-or-redact",
    actionLabel: "Preserve unresolved; delete or redact after resolution window",
    evidenceImpact: "Preserves unresolved failure evidence for incident review and repair.",
  },
  {
    dataArea: "test-operational-data",
    dataAreaLabel: "Test-mode operational data",
    modes: ["test"],
    window: {
      kind: "days",
      days: RETENTION_WINDOWS.testOperationalData,
    },
    windowLabel: "90 days",
    action: "delete-or-anonymize",
    actionLabel: "Delete or anonymize when not linked to live evidence",
    evidenceImpact: "Preserves any test record linked to live evidence.",
  },
  {
    dataArea: "generic-metadata",
    dataAreaLabel: "Generic metadata fragments",
    modes: BOTH_MODES,
    window: { kind: "days", days: RETENTION_WINDOWS.genericMetadata },
    windowLabel: "180 days",
    action: "redact-where-safe",
    actionLabel: "Redact stale personal, token-like, or payload-like fragments",
    evidenceImpact: "Preserves fragments that remain necessary evidence.",
  },
] as const;

export function parseRetentionMode(
  value: unknown,
  fallback: RetentionReportMode = "all",
): RetentionReportMode {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (value === "live" || value === "test" || value === "all") {
    return value;
  }

  throw new Error("mode must be one of: live, test, all.");
}

export function parsePositiveInteger(value: unknown, label = "value"): number {
  const normalized = typeof value === "number" ? String(value) : value;

  if (typeof normalized !== "string" || !/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${label} must be a positive integer.`);
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

export function parseRetentionWindowDays(
  value: unknown,
  fallback: number,
  label = "windowDays",
): number {
  return parsePositiveInteger(
    value === undefined || value === null || value === "" ? fallback : value,
    label,
  );
}

export function getRetentionPolicyForMode(
  mode: RetentionReportMode,
): readonly RetentionPolicyRecord[] {
  if (mode === "all") {
    return RETENTION_POLICY;
  }

  return RETENTION_POLICY.filter((record) => record.modes.includes(mode));
}

export function isFailedWebhookPayloadRetentionExpired(input: {
  resolvedAt: Date | null;
  asOf: Date;
  windowYears?: number;
}): boolean {
  if (input.resolvedAt === null) {
    return false;
  }

  const windowYears = parsePositiveInteger(
    input.windowYears ?? RETENTION_WINDOWS.failedWebhookPayloadAfterResolutionYears,
    "windowYears",
  );
  const expiresAt = new Date(input.resolvedAt);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + windowYears);

  return input.asOf.getTime() >= expiresAt.getTime();
}
