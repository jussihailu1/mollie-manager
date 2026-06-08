import "server-only";

import type { MollieMode } from "@/lib/env";
import {
  getInvoiceAutomationCronHeartbeat,
  getInvoiceAutomationSnapshot,
  type InvoiceAutomationCronHeartbeat,
  type InvoiceAutomationSnapshot,
} from "@/lib/invoice-automation-metrics";
import {
  getInvoiceDeliveryQueueSummary,
  type InvoiceDeliveryQueueSummary,
} from "@/lib/invoice-delivery";
import {
  getReliabilitySnapshot,
  type ReliabilitySnapshot,
} from "@/lib/reliability/data";

export type ReliabilityOpsSnapshot = {
  invoiceAutomation: InvoiceAutomationSnapshot;
  invoiceAutomationCron: InvoiceAutomationCronHeartbeat;
  invoiceDeliveryQueue: InvoiceDeliveryQueueSummary;
  reliability: ReliabilitySnapshot;
};

const EMPTY_INVOICE_AUTOMATION_SNAPSHOT = {
  dueFirstPaymentPendingCount: 0,
  dueRecurringPendingCount: 0,
  failedFirstPaymentCount: 0,
  failedFirstPaymentRecoverableCount: 0,
  failedRecurringCount: 0,
  failedRecurringRecoverableCount: 0,
} satisfies InvoiceAutomationSnapshot;

const EMPTY_INVOICE_DELIVERY_QUEUE_SUMMARY = {
  dueRetryFirstPaymentCount: 0,
  dueRetryRecurringCount: 0,
  permanentFailureFirstPaymentCount: 0,
  permanentFailureRecurringCount: 0,
} satisfies InvoiceDeliveryQueueSummary;

export async function getReliabilityOpsSnapshot(options: {
  billingSettingsComplete?: boolean;
  mode: MollieMode;
}): Promise<ReliabilityOpsSnapshot> {
  const billingSettingsComplete = options.billingSettingsComplete ?? true;

  const [reliability, invoiceAutomationCron, invoiceAutomation, invoiceDeliveryQueue] =
    await Promise.all([
      getReliabilitySnapshot({ mode: options.mode }),
      getInvoiceAutomationCronHeartbeat(options.mode),
      billingSettingsComplete
        ? getInvoiceAutomationSnapshot(options.mode)
        : Promise.resolve(EMPTY_INVOICE_AUTOMATION_SNAPSHOT),
      billingSettingsComplete
        ? getInvoiceDeliveryQueueSummary(options.mode)
        : Promise.resolve(EMPTY_INVOICE_DELIVERY_QUEUE_SUMMARY),
    ]);

  return {
    invoiceAutomation,
    invoiceAutomationCron,
    invoiceDeliveryQueue,
    reliability,
  };
}
