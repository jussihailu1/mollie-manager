"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { requireViewerSession } from "@/lib/auth/session";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { attemptSubscriptionActivation } from "@/lib/onboarding/subscription-activation";
import { repairCustomerBillingState as repairCustomerBillingStateImpl } from "@/lib/onboarding/customer-billing-repair";
import {
  archiveCustomerRecord,
  restoreCustomerRecord,
} from "@/lib/onboarding/customer-archive-flow";
import { createCustomerFlow } from "@/lib/onboarding/customer-creation-flow";
import { linkCustomerToEboekhoudenRelation } from "@/lib/onboarding/customer-relation-link-flow";
import { createFirstPaymentActionFlow } from "@/lib/onboarding/first-payment-action-flow";
import { getLatestConsentLinkUrl } from "@/lib/onboarding/data";
import { removePendingConsentLink } from "@/lib/onboarding/pending-consent-link";
import { updateActionPath } from "@/lib/onboarding/action-path";
import { buildDrawerPath } from "@/lib/dashboard-drawer-route";
import { describeSubscriptionActivationResult } from "@/lib/onboarding/subscription-activation-result";
import {
  redirectWithMessage,
  serializeError,
  serializeIntegrationError,
  getLocalCustomer,
} from "@/lib/onboarding/action-helpers";
import { getCurrentTenantSelectionForViewer } from "@/lib/tenant-context";
import { saveCustomerBillingProfile } from "@/lib/invoicing/customer-billing-profile";
export const repairCustomerBillingState = repairCustomerBillingStateImpl;

const createCustomerSchema = z.object({
  address: z.string().trim().max(240).optional(),
  businessName: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(120),
  email: z.string().email(),
  eboekhoudenRelationId: z.coerce.number().int().positive().optional(),
  notes: z.string().trim().max(1000).optional(),
  phone: z.string().trim().max(80).optional(),
  returnTo: z.string().trim().startsWith("/").default("/customers"),
  source: z.enum(["local", "eboekhouden"]).default("local"),
});

const linkEboekhoudenRelationSchema = z.object({
  address: z.string().trim().max(240).optional(),
  businessName: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(120),
  customerId: z.string().uuid(),
  email: z.string().email(),
  eboekhoudenRelationId: z.coerce.number().int().positive(),
  notes: z.string().trim().max(1000).optional(),
  phone: z.string().trim().max(80).optional(),
  returnTo: z.string().trim().startsWith("/").default("/customers"),
});

const createFirstPaymentSchema = z.object({
  customerId: z.string().uuid(),
  firstPaymentMode: z
    .enum(["real_installment", "mandate_only"])
    .default("real_installment"),
  replacePendingConsent: z.enum(["yes"]).optional(),
  returnTo: z.string().trim().startsWith("/").default("/customers"),
  subscriptionAmountValue: z.string().trim().min(1),
  subscriptionDescription: z.string().trim().min(2).max(140),
  subscriptionInterval: z.enum(["weekly", "monthly", "yearly"]).default("monthly"),
  subscriptionStartDate: z.string().trim().min(1),
  subscriptionTermMode: z.enum(["open_ended", "fixed_term"]).default("open_ended"),
  totalPayments: z
    .union([z.string().trim().length(0), z.coerce.number().int().positive()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === "") {
        return null;
      }

      return Number(value);
    }),
});

const syncCustomerSchema = z.object({
  customerId: z.string().uuid(),
  returnTo: z.string().trim().startsWith("/").default("/customers"),
});

const deletePendingConsentLinkSchema = z.object({
  customerId: z.string().uuid(),
});

const customerArchiveSchema = z.object({
  customerId: z.string().uuid(),
  returnTo: z.string().trim().startsWith("/").default("/customers"),
});

const createSubscriptionSchema = z.object({
  customerId: z.string().uuid(),
  returnTo: z.string().trim().startsWith("/").default("/customers"),
});

const customerBillingProfileSchema = z.object({
  city: z.string().trim().min(1).max(120), countryCode: z.literal("NL").default("NL"), customerId: z.string().uuid(),
  email: z.string().trim().email(), houseNumber: z.string().trim().min(1).max(40), legalName: z.string().trim().min(1).max(180),
  postalCode: z.string().trim().min(1).max(20), returnTo: z.string().trim().startsWith("/").default("/customers"), street: z.string().trim().min(1).max(180),
});

export async function saveCustomerBillingProfileAction(formData: FormData) {
  const parsed = customerBillingProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return await redirectWithMessage("/customers", { error: "Customer invoice profile input is incomplete." });
  await requireViewerSession();
  const { currentTenant } = await getCurrentTenantSelectionForViewer();
  try {
    await saveCustomerBillingProfile({ ...parsed.data, tenantId: currentTenant.id });
    revalidatePath("/customers");
    return await redirectWithMessage(parsed.data.returnTo, { notice: "Customer invoice profile saved for future invoices." });
  } catch (error) {
    unstable_rethrow(error);
    return await redirectWithMessage(parsed.data.returnTo, { error: serializeError(error) });
  }
}

export async function archiveCustomerAction(formData: FormData) {
  const parsed = customerArchiveSchema.safeParse({
    customerId: formData.get("customerId"),
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    return await redirectWithMessage("/customers", {
      error: "Customer id is missing.",
    });
  }

  const session = await requireViewerSession();
  const tenantSelection = await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();
  const returnTo = buildDrawerPath("customers", parsed.data.customerId, parsed.data.returnTo);
  const result = await archiveCustomerRecord({
    actor: {
      email: session.user.email ?? null,
      kind: "user",
    },
    customerId: parsed.data.customerId,
    tenantId: tenantSelection.currentTenant.id,
    mode: selectedMode,
  });

  if (result.status === "not_found") {
    return await redirectWithMessage(returnTo, {
      error: "Customer not found in the selected Mollie mode.",
    });
  }

  if (result.status === "blocked") {
    return await redirectWithMessage(returnTo, {
      error: result.kind === "error" ? result.message : undefined,
      notice: result.kind === "notice" ? result.message : undefined,
    });
  }

  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath("/payments");
  revalidatePath("/notifications");
  return await redirectWithMessage(returnTo, {
    notice: "Customer archived.",
  });
}

export async function restoreCustomerAction(formData: FormData) {
  const parsed = customerArchiveSchema.safeParse({
    customerId: formData.get("customerId"),
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    return await redirectWithMessage("/customers", {
      error: "Customer id is missing.",
    });
  }

  const session = await requireViewerSession();
  const tenantSelection = await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();
  const returnTo = buildDrawerPath(
    "customers",
    parsed.data.customerId,
    updateActionPath(parsed.data.returnTo, { view: null }),
  );
  const result = await restoreCustomerRecord({
    actor: {
      email: session.user.email ?? null,
      kind: "user",
    },
    customerId: parsed.data.customerId,
    tenantId: tenantSelection.currentTenant.id,
    mode: selectedMode,
  });

  if (result.status === "not_found") {
    return await redirectWithMessage(returnTo, {
      error: "Customer not found in the selected Mollie mode.",
    });
  }

  if (result.status === "blocked") {
    return await redirectWithMessage(returnTo, {
      notice: result.message,
    });
  }

  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath("/payments");
  revalidatePath("/notifications");
  return await redirectWithMessage(returnTo, {
    notice: "Customer restored.",
  });
}

export async function createCustomerAction(formData: FormData) {
  const parsed = createCustomerSchema.safeParse({
    address: formData.get("address") || undefined,
    businessName: formData.get("businessName"),
    contactName: formData.get("contactName"),
    email: formData.get("email"),
    eboekhoudenRelationId: formData.get("eboekhoudenRelationId") || undefined,
    notes: formData.get("notes") || undefined,
    phone: formData.get("phone") || undefined,
    returnTo: formData.get("returnTo") || undefined,
    source: formData.get("source") || "local",
  });

  if (!parsed.success) {
    return await redirectWithMessage("/customers", {
      error: parsed.error.issues[0]?.message ?? "Enter a valid customer.",
    });
  }

  await requireViewerSession();
  const tenantSelection = await getCurrentTenantSelectionForViewer();

  try {
    const selectedMode = await getSelectedMollieMode();
    const result = await createCustomerFlow({
      input: parsed.data,
      mode: selectedMode,
      tenantId: tenantSelection.currentTenant.id,
    });

    const returnTo = buildDrawerPath("customers", result.localCustomerId, parsed.data.returnTo);

    revalidatePath("/");
    revalidatePath("/customers");
    revalidatePath("/payments");
    return await redirectWithMessage(returnTo, {
      notice: result.linkedRelation
        ? "Customer imported from e-Boekhouden. You can now generate the first payment link."
        : "Customer created as unlinked from e-Boekhouden. You can now generate the first payment link.",
    });
  } catch (error) {
    unstable_rethrow(error);
    return await redirectWithMessage("/customers", {
      error: serializeIntegrationError(error),
    });
  }
}

export async function linkEboekhoudenRelationAction(formData: FormData) {
  const parsed = linkEboekhoudenRelationSchema.safeParse({
    address: formData.get("address") || undefined,
    businessName: formData.get("businessName"),
    contactName: formData.get("contactName"),
    customerId: formData.get("customerId"),
    email: formData.get("email"),
    eboekhoudenRelationId: formData.get("eboekhoudenRelationId"),
    notes: formData.get("notes") || undefined,
    phone: formData.get("phone") || undefined,
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    return await redirectWithMessage("/customers", {
      error: parsed.error.issues[0]?.message ?? "Enter valid customer details.",
    });
  }

  const session = await requireViewerSession();
  const tenantSelection = await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();
  const returnTo = buildDrawerPath("customers", parsed.data.customerId, parsed.data.returnTo);
  const customer = await getLocalCustomer(
    parsed.data.customerId,
    selectedMode,
    tenantSelection.currentTenant.id,
  );

  if (!customer) {
    return await redirectWithMessage(returnTo, {
      error: "Customer not found in the selected Mollie mode.",
    });
  }

  if (customer.archivedAt) {
    return await redirectWithMessage(returnTo, {
      error: "Restore this customer before changing e-Boekhouden links.",
    });
  }

  try {
    await linkCustomerToEboekhoudenRelation({
      actor: {
        email: session.user.email ?? null,
        kind: "user",
      },
      customerId: customer.id,
      fields: {
        address: parsed.data.address,
        businessName: parsed.data.businessName,
        contactName: parsed.data.contactName,
        email: parsed.data.email,
        eboekhoudenRelationId: parsed.data.eboekhoudenRelationId,
        notes: parsed.data.notes,
        phone: parsed.data.phone,
      },
      tenantId: tenantSelection.currentTenant.id,
      mode: selectedMode,
    });

    revalidatePath("/");
    revalidatePath("/customers");
    revalidatePath("/payments");
    return await redirectWithMessage(returnTo, {
      notice: "Customer linked to e-Boekhouden.",
    });
  } catch (error) {
    unstable_rethrow(error);
    return await redirectWithMessage(returnTo, {
      error: serializeIntegrationError(error),
    });
  }
}

export type CreateFirstPaymentActionState =
  | { consentLinkUrl: string; error?: never }
  | { consentLinkUrl?: never; error: string }
  | null;

export type DeletePendingConsentLinkActionState =
  | { deleted: true; error?: never }
  | { deleted?: never; error: string }
  | null;

export async function createFirstPaymentAction(
  _previousState: CreateFirstPaymentActionState,
  formData: FormData,
): Promise<CreateFirstPaymentActionState> {
  const parsed = createFirstPaymentSchema.safeParse({
    customerId: formData.get("customerId"),
      firstPaymentMode: formData.get("firstPaymentMode") || undefined,
      replacePendingConsent: formData.get("replacePendingConsent") || undefined,
    returnTo: formData.get("returnTo") || undefined,
    subscriptionAmountValue: formData.get("subscriptionAmountValue"),
    subscriptionDescription: formData.get("subscriptionDescription"),
    subscriptionInterval: formData.get("subscriptionInterval") || undefined,
    subscriptionStartDate: formData.get("subscriptionStartDate"),
    subscriptionTermMode: formData.get("subscriptionTermMode") || undefined,
    totalPayments: formData.get("totalPayments") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a valid first payment." };
  }

  const session = await requireViewerSession();
  const tenantSelection = await getCurrentTenantSelectionForViewer();

  const selectedMode = await getSelectedMollieMode();
  try {
    const result = await createFirstPaymentActionFlow({
      actor: {
        email: session.user.email ?? null,
        kind: "user",
      },
      customerId: parsed.data.customerId,
      tenantId: tenantSelection.currentTenant.id,
      mode: selectedMode,
      planInput: {
        firstPaymentMode: parsed.data.firstPaymentMode,
        subscriptionAmountValue: parsed.data.subscriptionAmountValue,
        subscriptionDescription: parsed.data.subscriptionDescription,
        subscriptionInterval: parsed.data.subscriptionInterval,
        subscriptionStartDate: parsed.data.subscriptionStartDate,
        subscriptionTermMode: parsed.data.subscriptionTermMode,
        totalPayments: parsed.data.totalPayments,
      },
      replacePendingConsent: parsed.data.replacePendingConsent === "yes",
    });

    if (result.status === "not_found_or_unlinked") {
      return { error: "Customer not found in the selected Mollie mode or not linked to Mollie." };
    }

    if (result.status === "archived") {
      return { error: "Restore this customer before creating a payment link." };
    }

    if (result.status === "blocked") {
      return { error: result.reason };
    }

    revalidatePath("/");
    revalidatePath("/customers");
    revalidatePath("/payments");
    const consentLinkUrl = await getLatestConsentLinkUrl(
      parsed.data.customerId,
      selectedMode,
      tenantSelection.currentTenant.id,
    );

    if (!consentLinkUrl) {
      return {
        error: "Consent link was created, but could not be loaded. Reopen the customer to retrieve it.",
      };
    }

    return { consentLinkUrl };
  } catch (error) {
    unstable_rethrow(error);
    return { error: serializeError(error) };
  }
}

export async function deletePendingConsentLinkAction(
  _previousState: DeletePendingConsentLinkActionState,
  formData: FormData,
): Promise<DeletePendingConsentLinkActionState> {
  const parsed = deletePendingConsentLinkSchema.safeParse({
    customerId: formData.get("customerId"),
  });

  if (!parsed.success) {
    return { error: "Customer id is missing." };
  }

  const session = await requireViewerSession();
  const tenantSelection = await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();

  try {
    await removePendingConsentLink({
      actor: { email: session.user.email ?? null, kind: "user" },
      customerId: parsed.data.customerId,
      mode: selectedMode,
      reason: "deleted",
      tenantId: tenantSelection.currentTenant.id,
    });
    revalidatePath("/");
    revalidatePath("/customers");
    revalidatePath("/payments");
    return { deleted: true };
  } catch (error) {
    unstable_rethrow(error);
    return { error: serializeError(error) };
  }
}

export async function syncCustomerBillingStateAction(formData: FormData) {
  const parsed = syncCustomerSchema.safeParse({
    customerId: formData.get("customerId"),
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    return await redirectWithMessage("/customers", {
      error: "Customer id is missing.",
    });
  }

  const session = await requireViewerSession();
  const tenantSelection = await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();
  const returnTo = buildDrawerPath("customers", parsed.data.customerId, parsed.data.returnTo);

  try {
    const result = await repairCustomerBillingState({
      actor: {
        email: session.user.email ?? null,
        kind: "user",
      },
      customerId: parsed.data.customerId,
      tenantId: tenantSelection.currentTenant.id,
      mode: selectedMode,
    });

    if (result.status === "skipped") {
      const message =
        result.reason === "archived"
          ? "Restore this customer before repairing billing state."
          : result.reason === "not_linked"
            ? "Customer is not linked to Mollie."
            : "Customer not found in the selected Mollie mode.";

      return await redirectWithMessage(returnTo, {
        error: message,
      });
    }

    revalidatePath("/");
    revalidatePath("/customers");
    revalidatePath("/payments");
    revalidatePath("/notifications");
    return await redirectWithMessage(returnTo, {
      notice: "Customer state repaired from Mollie.",
    });
  } catch (error) {
    unstable_rethrow(error);
    return await redirectWithMessage(returnTo, {
      error: serializeError(error),
    });
  }
}

export async function createSubscriptionAction(formData: FormData) {
  const parsed = createSubscriptionSchema.safeParse({
    customerId: formData.get("customerId"),
    returnTo: formData.get("returnTo") || undefined,
  });

  if (!parsed.success) {
    return await redirectWithMessage("/customers", {
      error: parsed.error.issues[0]?.message ?? "Enter a valid subscription.",
    });
  }

  const session = await requireViewerSession();
  const tenantSelection = await getCurrentTenantSelectionForViewer();
  const selectedMode = await getSelectedMollieMode();
  const returnTo = buildDrawerPath("customers", parsed.data.customerId, parsed.data.returnTo);

  try {
    const result = await attemptSubscriptionActivation({
      actor: {
        email: session.user.email ?? null,
        kind: "user",
      },
      customerId: parsed.data.customerId,
      mode: selectedMode,
      tenantId: tenantSelection.currentTenant.id,
      trigger: "manual",
    });
    const feedback = describeSubscriptionActivationResult(result);

    if (feedback.shouldRevalidate) {
      revalidatePath("/");
      revalidatePath("/customers");
      revalidatePath("/payments");
      revalidatePath("/notifications");
    }

    return await redirectWithMessage(returnTo, {
      error: feedback.error ?? undefined,
      notice: feedback.notice ?? undefined,
    });
  } catch (error) {
    unstable_rethrow(error);
    return await redirectWithMessage(returnTo, {
      error: serializeError(error),
    });
  }
}
