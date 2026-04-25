import "server-only";

import type { MollieMode } from "@/lib/env";
import type {
  CustomerOverview,
  OperationalAlert,
  PaymentOverview,
} from "@/lib/onboarding/data";
import type { AlertInboxItem, AuditActivityItem } from "@/lib/reliability/data";

export type UiCustomerRecord = {
  address: string | null;
  businessName: string | null;
  contactName: string | null;
  createdAt: string;
  eboekhoudenLinkStatus: "linked" | "unlinked" | "needs_review" | "sync_error";
  eboekhoudenRelationCode: string | null;
  eboekhoudenRelationId: number | null;
  eboekhoudenSyncedAt: string | null;
  email: string;
  hasValidMandate: boolean;
  id: string;
  latestFirstPaymentCheckoutUrl: string | null;
  latestFirstPaymentLinkStatus: string | null;
  latestFirstPaymentLinkUrl: string | null;
  latestFirstPaymentPaidAt: string | null;
  latestFirstPaymentStatus: string | null;
  latestMandateStatus: string | null;
  latestSubscriptionStatus: string | null;
  mode: MollieMode;
  notes: string | null;
  phone: string | null;
  subscriptionCount: number;
};

export type UiPaymentRecord = {
  amount: string;
  createdAt: string;
  currency: string;
  customerBusinessName: string;
  customerId: string | null;
  description: string;
  id: string;
  paidAt: string | null;
  reference: string;
  status: "pending" | "paid" | "failed" | "expired";
  type: "first" | "recurring";
};

export type UiNotificationRecord = {
  createdAt: string;
  customerId: string | null;
  href: string;
  id: string;
  message: string;
  read: boolean;
  severity: "critical" | "warning" | "info";
  status: "acknowledged" | "open" | "resolved";
  title: string;
  type: "payment" | "subscription" | "system";
};

export type UiAttentionRecord = {
  createdAt: string;
  customerId: string | null;
  href: string;
  id: string;
  message: string;
  severity: "critical" | "warning";
  title: string;
  type: "payment" | "subscription";
};

export type UiActivityRecord = {
  createdAt: string;
  id: string;
  summary: string;
};

function mapPaymentStatus(
  mollieStatus: string | null,
): UiPaymentRecord["status"] {
  switch (mollieStatus) {
    case "paid":
      return "paid";
    case "failed":
    case "canceled":
    case "charged_back":
      return "failed";
    case "expired":
      return "expired";
    default:
      return "pending";
  }
}

function mapAlertType(alert: AlertInboxItem): UiNotificationRecord["type"] {
  if (alert.paymentId) {
    return "payment";
  }

  if (alert.subscriptionId) {
    return "subscription";
  }

  return "system";
}

export function toUiCustomerRecord(customer: CustomerOverview): UiCustomerRecord {
  return {
    address: customer.address,
    businessName: customer.businessName,
    contactName: customer.contactName,
    createdAt: customer.createdAt,
    eboekhoudenLinkStatus: customer.eboekhoudenLinkStatus,
    eboekhoudenRelationCode: customer.eboekhoudenRelationCode,
    eboekhoudenRelationId: customer.eboekhoudenRelationId,
    eboekhoudenSyncedAt: customer.eboekhoudenSyncedAt,
    email: customer.email,
    hasValidMandate: customer.hasValidMandate,
    id: customer.id,
    latestFirstPaymentCheckoutUrl: customer.latestFirstPaymentCheckoutUrl,
    latestFirstPaymentLinkStatus: customer.latestFirstPaymentLinkStatus,
    latestFirstPaymentLinkUrl: customer.latestFirstPaymentLinkUrl,
    latestFirstPaymentPaidAt: customer.latestFirstPaymentPaidAt,
    latestFirstPaymentStatus: customer.latestFirstPaymentStatus,
    latestMandateStatus: customer.latestMandateStatus,
    latestSubscriptionStatus: customer.latestSubscriptionStatus,
    mode: customer.mode,
    notes: customer.notes,
    phone: customer.phone,
    subscriptionCount: customer.subscriptionCount,
  };
}

export function toUiPaymentRecord(payment: PaymentOverview): UiPaymentRecord {
  return {
    amount: payment.amountValue,
    createdAt: payment.createdAt,
    currency: payment.amountCurrency,
    customerBusinessName:
      payment.customerName ?? payment.customerEmail ?? "Unknown customer",
    customerId: payment.customerId,
    description:
      payment.subscriptionDescription ??
      (payment.paymentType === "first"
        ? "First mandate payment"
        : "Recurring subscription payment"),
    id: payment.id,
    paidAt: payment.paidAt,
    reference: payment.molliePaymentId ?? payment.id,
    status: mapPaymentStatus(payment.mollieStatus),
    type: payment.paymentType === "first" ? "first" : "recurring",
  };
}

export function toUiNotificationRecord(
  alert: AlertInboxItem,
): UiNotificationRecord {
  return {
    createdAt: alert.createdAt,
    customerId: alert.customerId,
    href: alert.href,
    id: alert.id,
    message: alert.message,
    read: alert.status !== "open",
    severity: alert.severity,
    status: alert.status,
    title: alert.title,
    type: mapAlertType(alert),
  };
}

export function toUiAttentionRecord(
  alert: OperationalAlert,
): UiAttentionRecord {
  return {
    createdAt: alert.createdAt,
    customerId: alert.customerId,
    href: alert.href,
    id: alert.id,
    message: alert.summary,
    severity: alert.severity,
    title: alert.title,
    type: alert.type,
  };
}

export function toUiActivityRecord(
  activity: AuditActivityItem,
): UiActivityRecord {
  return {
    createdAt: activity.createdAt,
    id: activity.id,
    summary: activity.summary,
  };
}
