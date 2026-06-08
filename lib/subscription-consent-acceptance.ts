import { z } from "zod";

export const consentTokenSchema = z.string().trim().min(8).max(200);

const acceptConsentSchema = z.object({
  cancellationPolicyAck: z.string().optional(),
  recurringBillingPolicyAck: z.string().optional(),
  recurringTermsAck: z.string().optional(),
  token: consentTokenSchema,
});

const consentCheckboxInputs = [
  {
    field: "recurringTermsAck",
    key: "recurring_terms_ack",
  },
  {
    field: "recurringBillingPolicyAck",
    key: "recurring_billing_policy_ack",
  },
  {
    field: "cancellationPolicyAck",
    key: "cancellation_policy_ack",
  },
] as const;

export type ConsentAcceptanceInput = {
  cancellationPolicyAck?: FormDataEntryValue | null;
  recurringBillingPolicyAck?: FormDataEntryValue | null;
  recurringTermsAck?: FormDataEntryValue | null;
  token?: FormDataEntryValue | null;
};

export type ParsedConsentAcceptanceInput =
  | {
      acknowledgedKeys: string[];
      success: true;
      token: string;
    }
  | {
      success: false;
      tokenForRedirect: string;
    };

export function buildSubscriptionConsentPath(
  token: string,
  params: Record<string, string | null | undefined> = {},
) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (!value) {
      continue;
    }

    search.set(key, value);
  }

  const searchString = search.toString();
  return `/subscribe/${token}${searchString ? `?${searchString}` : ""}`;
}

function normalizeFormValue(value: FormDataEntryValue | null | undefined) {
  return typeof value === "string" && value ? value : undefined;
}

export function parseConsentAcceptanceInput(
  input: ConsentAcceptanceInput,
): ParsedConsentAcceptanceInput {
  const parsed = acceptConsentSchema.safeParse({
    cancellationPolicyAck: normalizeFormValue(input.cancellationPolicyAck),
    recurringBillingPolicyAck: normalizeFormValue(input.recurringBillingPolicyAck),
    recurringTermsAck: normalizeFormValue(input.recurringTermsAck),
    token: input.token,
  });

  if (!parsed.success) {
    return {
      success: false,
      tokenForRedirect: typeof input.token === "string" ? input.token : "",
    };
  }

  return {
    acknowledgedKeys: consentCheckboxInputs
      .flatMap((checkbox) => (parsed.data[checkbox.field] ? [checkbox.key] : [])),
    success: true,
    token: parsed.data.token,
  };
}

export function findMissingRequiredConsentKey(
  requiredKeys: readonly string[],
  acknowledgedKeys: readonly string[],
) {
  return requiredKeys.find((requiredKey) => !acknowledgedKeys.includes(requiredKey));
}
