import type { MollieMode } from "@/lib/env";
import { getLocalCustomer } from "@/lib/onboarding/action-helpers";
import { getCustomerDetail } from "@/lib/onboarding/data";
import { resolveFirstPaymentCreationBlocker } from "@/lib/onboarding/first-payment-blocker";
import { createFirstPaymentOnboardingFlow } from "@/lib/onboarding/first-payment-onboarding-flow";

type FirstPaymentActionActor = {
  email?: string | null;
  kind: "user";
};

type FirstPaymentActionPlanInput = {
  firstPaymentMode: "real_installment" | "mandate_only";
  serviceEndAt?: string;
  subscriptionAmountValue: string;
  subscriptionDescription: string;
  subscriptionInterval: "weekly" | "monthly" | "yearly";
  subscriptionStartDate: string;
  subscriptionTermMode: "open_ended" | "fixed_term";
  totalPayments: number | null;
};

type CreateFirstPaymentActionFlowResult =
  | {
      status: "created";
    }
  | {
      status: "archived";
    }
  | {
      status: "blocked";
      reason: string;
    }
  | {
      status: "not_found_or_unlinked";
    };

export async function createFirstPaymentActionFlow(input: {
  actor: FirstPaymentActionActor;
  customerId: string;
  mode: MollieMode;
  planInput: FirstPaymentActionPlanInput;
  tenantId?: string;
}): Promise<CreateFirstPaymentActionFlowResult> {
  const customer = await getLocalCustomer(input.customerId, input.mode, input.tenantId);

  if (!customer || !customer.mollieCustomerId) {
    return {
      status: "not_found_or_unlinked",
    };
  }

  if (customer.archivedAt) {
    return {
      status: "archived",
    };
  }

  const detail = await getCustomerDetail(customer.id, input.mode, input.tenantId);
  const firstPaymentBlocker = resolveFirstPaymentCreationBlocker({
    paymentLinks: detail?.paymentLinks ?? [],
    payments: detail?.payments ?? [],
  });

  if (firstPaymentBlocker) {
    return {
      reason: firstPaymentBlocker,
      status: "blocked",
    };
  }

  await createFirstPaymentOnboardingFlow({
    actor: input.actor,
    customer: {
      id: customer.id,
      mollieCustomerId: customer.mollieCustomerId,
    },
    planInput: input.planInput,
    selectedMode: input.mode,
    tenantId: input.tenantId,
  });

  return {
    status: "created",
  };
}
