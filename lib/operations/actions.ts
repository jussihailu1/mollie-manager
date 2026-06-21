"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { requireViewerSession } from "@/lib/auth/session";
import { getSelectedMollieMode } from "@/lib/dashboard-mode";
import { syncSubscriptionByLocalId } from "@/lib/reliability/sync";
import { getManagedSubscription } from "@/lib/reliability/sync-resource-state";
import {
  redirectWithMessage,
  serializeError,
} from "@/lib/operations/action-helpers";

const manageSubscriptionSchema = z.object({
  returnTo: z.string().trim().startsWith("/").default("/customers"),
  subscriptionId: z.string().uuid(),
});

export async function syncSubscriptionAction(formData: FormData) {
  const parsed = manageSubscriptionSchema.safeParse({
    returnTo: formData.get("returnTo"),
    subscriptionId: formData.get("subscriptionId"),
  });

  if (!parsed.success) {
    redirectWithMessage("/customers", {
      error: "Subscription id is missing.",
    });
  }

  const session = await requireViewerSession();
  const selectedMode = await getSelectedMollieMode();
  const subscription = await getManagedSubscription(parsed.data.subscriptionId);

  if (!subscription || subscription.mode !== selectedMode) {
    redirectWithMessage("/customers", {
      error: "Subscription not found in the selected Mollie mode.",
    });
  }

  try {
    await syncSubscriptionByLocalId(subscription.id, {
      actor: {
        email: session.user.email ?? null,
        kind: "user",
      },
      strictMode: true,
    });

    revalidatePath("/customers");
    revalidatePath("/payments");
    revalidatePath("/notifications");
    redirectWithMessage(parsed.data.returnTo, {
      notice: "Subscription and payment history refreshed from Mollie.",
    });
  } catch (error) {
    unstable_rethrow(error);
    redirectWithMessage(parsed.data.returnTo, {
      error: serializeError(error),
    });
  }
}
