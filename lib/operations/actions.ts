"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { requireViewerSession } from "@/lib/auth/session";
import { transaction } from "@/lib/db";
import { getMollieClient } from "@/lib/mollie/client";
import { getManagedSubscription, syncSubscriptionByLocalId } from "@/lib/reliability/sync";

const manageSubscriptionSchema = z.object({
  returnTo: z.string().trim().startsWith("/").default("/subscriptions"),
  subscriptionId: z.string().uuid(),
});

function buildPath(pathname: string, params?: URLSearchParams) {
  const search = params?.toString();
  return search ? `${pathname}?${search}` : pathname;
}

function redirectWithMessage(
  pathname: string,
  options: { error?: string; notice?: string },
): never {
  const params = new URLSearchParams();

  if (options.notice) {
    params.set("notice", options.notice);
  }

  if (options.error) {
    params.set("error", options.error);
  }

  redirect(buildPath(pathname, params));
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return error.message.slice(0, 180);
  }

  return "Something went wrong while talking to Mollie.";
}

export async function syncSubscriptionAction(formData: FormData) {
  const parsed = manageSubscriptionSchema.safeParse({
    returnTo: formData.get("returnTo"),
    subscriptionId: formData.get("subscriptionId"),
  });

  if (!parsed.success) {
    redirectWithMessage("/subscriptions", {
      error: "Subscription id is missing.",
    });
  }

  const session = await requireViewerSession();
  const subscription = await getManagedSubscription(parsed.data.subscriptionId);

  if (!subscription) {
    redirectWithMessage("/subscriptions", {
      error: "Subscription not found.",
    });
  }

  try {
    await syncSubscriptionByLocalId(subscription.id, {
      actor: {
        email: session.user.email ?? null,
        kind: "user",
      },
    });

    revalidatePath("/subscriptions");
    revalidatePath("/payments");
    revalidatePath("/alerts");
    revalidatePath("/settings");
    revalidatePath(`/customers/${subscription.customerId}`);
    redirectWithMessage(parsed.data.returnTo, {
      notice: "Subscription and payment history refreshed from Mollie.",
    });
  } catch (error) {
    redirectWithMessage(parsed.data.returnTo, {
      error: serializeError(error),
    });
  }
}

export async function cancelSubscriptionAction(formData: FormData) {
  const parsed = manageSubscriptionSchema.safeParse({
    returnTo: formData.get("returnTo"),
    subscriptionId: formData.get("subscriptionId"),
  });

  if (!parsed.success) {
    redirectWithMessage("/subscriptions", {
      error: "Subscription id is missing.",
    });
  }

  const session = await requireViewerSession();
  const subscription = await getManagedSubscription(parsed.data.subscriptionId);

  if (!subscription) {
    redirectWithMessage("/subscriptions", {
      error: "Subscription not found.",
    });
  }

  if (!subscription.mollieSubscriptionId || !subscription.customerMollieId) {
    redirectWithMessage(parsed.data.returnTo, {
      error: "Subscription is not linked to Mollie.",
    });
  }

  if (subscription.localStatus === "future_charges_stopped") {
    redirectWithMessage(parsed.data.returnTo, {
      notice: "Future charges were already stopped for this subscription.",
    });
  }

  try {
    const mollie = getMollieClient(subscription.mode);
    const canceledSubscription = await mollie.customerSubscriptions.cancel(
      subscription.mollieSubscriptionId,
      {
        customerId: subscription.customerMollieId,
        idempotencyKey: crypto.randomUUID(),
      },
    );

    await transaction(async (client) => {
      await client.query(
        `
          update subscriptions
          set
            local_status = 'future_charges_stopped',
            mollie_status = $2,
            stop_after_current_period = true,
            canceled_at = coalesce($3::timestamptz, now()),
            metadata = $4::jsonb,
            updated_at = now(),
            last_synced_at = now()
          where id = $1
        `,
        [
          subscription.id,
          canceledSubscription.status,
          canceledSubscription.canceledAt ?? null,
          JSON.stringify({
            nextPaymentDate: canceledSubscription.nextPaymentDate ?? null,
          }),
        ],
      );

      await writeAuditLog(
        {
          action: "subscription.cancel",
          details: {
            localSubscriptionId: subscription.id,
            mollieSubscriptionId: subscription.mollieSubscriptionId,
          },
          entityId: subscription.id,
          entityType: "subscription",
          mode: subscription.mode,
          outcome: "success",
          summary: "Stopped future charges for the subscription in Mollie.",
        },
        client,
        {
          email: session.user.email ?? null,
          kind: "user",
        },
      );
    });

    await syncSubscriptionByLocalId(subscription.id, {
      actor: {
        email: session.user.email ?? null,
        kind: "user",
      },
    });

    revalidatePath("/subscriptions");
    revalidatePath("/payments");
    revalidatePath("/alerts");
    revalidatePath("/settings");
    revalidatePath(`/customers/${subscription.customerId}`);
    redirectWithMessage(parsed.data.returnTo, {
      notice: "Future charges stopped. The subscription state was refreshed from Mollie.",
    });
  } catch (error) {
    redirectWithMessage(parsed.data.returnTo, {
      error: serializeError(error),
    });
  }
}
