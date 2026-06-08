import {
  buildSubscriptionConsentPath,
  findMissingRequiredConsentKey,
  parseConsentAcceptanceInput,
  type ConsentAcceptanceInput,
} from "@/lib/subscription-consent-acceptance";

export type AcceptableSubscriptionConsent = {
  acceptedAt: string | null;
  checkoutUrl: string | null;
  consentId: string;
  requiredCheckboxKeys: string[];
};

export type MarkSubscriptionConsentAcceptedInput = {
  acceptedCheckboxKeys: string[];
  acceptedIp: string | null;
  acceptedUserAgent: string | null;
  consentId: string;
};

export type AcceptSubscriptionConsentFlowInput = {
  acceptedIp: string | null;
  acceptedUserAgent: string | null;
  formInput: ConsentAcceptanceInput;
};

export type AcceptSubscriptionConsentFlowResult = {
  redirectTo: string;
  status:
    | "accepted"
    | "already_accepted"
    | "checkout_missing"
    | "consent_form_invalid"
    | "consent_not_found"
    | "consent_required";
};

export type AcceptSubscriptionConsentFlowDependencies = {
  getConsentByToken: (token: string) => Promise<AcceptableSubscriptionConsent | null>;
  markConsentAccepted: (input: MarkSubscriptionConsentAcceptedInput) => Promise<void>;
};

export async function runAcceptSubscriptionConsentFlow(
  input: AcceptSubscriptionConsentFlowInput,
  dependencies: AcceptSubscriptionConsentFlowDependencies,
): Promise<AcceptSubscriptionConsentFlowResult> {
  const parsed = parseConsentAcceptanceInput(input.formInput);

  if (!parsed.success) {
    return {
      redirectTo: buildSubscriptionConsentPath(parsed.tokenForRedirect, {
        error: "consent_form_invalid",
      }),
      status: "consent_form_invalid",
    };
  }

  const consent = await dependencies.getConsentByToken(parsed.token);

  if (!consent) {
    return {
      redirectTo: buildSubscriptionConsentPath(parsed.token, {
        error: "consent_not_found",
      }),
      status: "consent_not_found",
    };
  }

  if (!consent.checkoutUrl) {
    return {
      redirectTo: buildSubscriptionConsentPath(parsed.token, {
        error: "checkout_missing",
      }),
      status: "checkout_missing",
    };
  }

  if (consent.acceptedAt) {
    return {
      redirectTo: consent.checkoutUrl,
      status: "already_accepted",
    };
  }

  const missingKey = findMissingRequiredConsentKey(
    consent.requiredCheckboxKeys,
    parsed.acknowledgedKeys,
  );

  if (missingKey) {
    return {
      redirectTo: buildSubscriptionConsentPath(parsed.token, {
        error: "consent_required",
      }),
      status: "consent_required",
    };
  }

  await dependencies.markConsentAccepted({
    acceptedCheckboxKeys: parsed.acknowledgedKeys,
    acceptedIp: input.acceptedIp,
    acceptedUserAgent: input.acceptedUserAgent,
    consentId: consent.consentId,
  });

  return {
    redirectTo: consent.checkoutUrl,
    status: "accepted",
  };
}
