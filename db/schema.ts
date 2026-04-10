import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const mollieModeEnum = pgEnum("mollie_mode", ["test", "live"]);

export const subscriptionLifecycleStateEnum = pgEnum(
  "subscription_lifecycle_state",
  [
    "draft",
    "awaiting_first_payment",
    "mandate_pending",
    "active",
    "payment_action_required",
    "future_charges_stopped",
    "charged_back",
    "out_of_sync",
    "cancelled",
  ],
);

export const paymentLifecycleTypeEnum = pgEnum("payment_lifecycle_type", [
  "first",
  "recurring",
  "manual",
  "refund",
]);

export const alertSeverityEnum = pgEnum("alert_severity", [
  "info",
  "warning",
  "critical",
]);

export const alertStatusEnum = pgEnum("alert_status", [
  "open",
  "acknowledged",
  "resolved",
]);

export const auditOutcomeEnum = pgEnum("audit_outcome", [
  "success",
  "failure",
]);

export const actorKindEnum = pgEnum("actor_kind", ["user", "system"]);

export const webhookProcessingStatusEnum = pgEnum(
  "webhook_processing_status",
  ["pending", "processed", "failed", "ignored"],
);

export const customers = pgTable(
  "customers",
  {
    id: text("id").primaryKey(),
    mode: mollieModeEnum("mode").notNull(),
    mollieCustomerId: text("mollie_customer_id"),
    fullName: text("full_name"),
    email: text("email").notNull(),
    locale: text("locale").notNull().default("nl_NL"),
    notes: text("notes"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", {
      mode: "string",
      withTimezone: true,
    }),
  },
  (table) => [
    unique("customers_mode_mollie_customer_id_key").on(
      table.mode,
      table.mollieCustomerId,
    ),
    index("customers_mode_email_idx").on(table.mode, table.email),
  ],
);

export const mandates = pgTable(
  "mandates",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull(),
    mode: mollieModeEnum("mode").notNull(),
    mollieMandateId: text("mollie_mandate_id").notNull(),
    method: text("method"),
    mollieStatus: text("mollie_status"),
    isValid: boolean("is_valid").notNull().default(false),
    details: jsonb("details")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", {
      mode: "string",
      withTimezone: true,
    }),
  },
  (table) => [
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: "mandates_customer_id_fkey",
    }).onDelete("cascade"),
    unique("mandates_mode_mollie_mandate_id_key").on(
      table.mode,
      table.mollieMandateId,
    ),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull(),
    mandateId: text("mandate_id"),
    mode: mollieModeEnum("mode").notNull(),
    mollieSubscriptionId: text("mollie_subscription_id"),
    localStatus: subscriptionLifecycleStateEnum("local_status")
      .notNull()
      .default("draft"),
    mollieStatus: text("mollie_status"),
    description: text("description").notNull(),
    interval: text("interval").notNull(),
    amountValue: numeric("amount_value", {
      precision: 12,
      scale: 2,
    }).notNull(),
    amountCurrency: char("amount_currency", { length: 3 }).notNull(),
    billingDay: integer("billing_day"),
    startDate: date("start_date", { mode: "string" }),
    stopAfterCurrentPeriod: boolean("stop_after_current_period")
      .notNull()
      .default(false),
    canceledAt: timestamp("canceled_at", {
      mode: "string",
      withTimezone: true,
    }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", {
      mode: "string",
      withTimezone: true,
    }),
  },
  (table) => [
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: "subscriptions_customer_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.mandateId],
      foreignColumns: [mandates.id],
      name: "subscriptions_mandate_id_fkey",
    }).onDelete("set null"),
    unique("subscriptions_mode_mollie_subscription_id_key").on(
      table.mode,
      table.mollieSubscriptionId,
    ),
    check("subscriptions_amount_value_check", sql`${table.amountValue} >= 0`),
    index("subscriptions_customer_idx").on(table.customerId, table.localStatus),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id"),
    subscriptionId: text("subscription_id"),
    mandateId: text("mandate_id"),
    mode: mollieModeEnum("mode").notNull(),
    paymentType: paymentLifecycleTypeEnum("payment_type").notNull(),
    molliePaymentId: text("mollie_payment_id"),
    mollieStatus: text("mollie_status"),
    sequenceType: text("sequence_type"),
    method: text("method"),
    amountValue: numeric("amount_value", {
      precision: 12,
      scale: 2,
    }).notNull(),
    amountCurrency: char("amount_currency", { length: 3 }).notNull(),
    checkoutUrl: text("checkout_url"),
    expiresAt: timestamp("expires_at", {
      mode: "string",
      withTimezone: true,
    }),
    paidAt: timestamp("paid_at", {
      mode: "string",
      withTimezone: true,
    }),
    failedAt: timestamp("failed_at", {
      mode: "string",
      withTimezone: true,
    }),
    disputedAt: timestamp("disputed_at", {
      mode: "string",
      withTimezone: true,
    }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", {
      mode: "string",
      withTimezone: true,
    }),
  },
  (table) => [
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: "payments_customer_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.subscriptionId],
      foreignColumns: [subscriptions.id],
      name: "payments_subscription_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.mandateId],
      foreignColumns: [mandates.id],
      name: "payments_mandate_id_fkey",
    }).onDelete("set null"),
    unique("payments_mode_mollie_payment_id_key").on(
      table.mode,
      table.molliePaymentId,
    ),
    check("payments_amount_value_check", sql`${table.amountValue} >= 0`),
    index("payments_subscription_idx").on(
      table.subscriptionId,
      table.paymentType,
    ),
  ],
);

export const paymentLinks = pgTable(
  "payment_links",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id"),
    mode: mollieModeEnum("mode").notNull(),
    molliePaymentLinkId: text("mollie_payment_link_id"),
    mollieStatus: text("mollie_status"),
    description: text("description").notNull(),
    amountValue: numeric("amount_value", {
      precision: 12,
      scale: 2,
    }).notNull(),
    amountCurrency: char("amount_currency", { length: 3 }).notNull(),
    checkoutUrl: text("checkout_url"),
    expiresAt: timestamp("expires_at", {
      mode: "string",
      withTimezone: true,
    }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", {
      mode: "string",
      withTimezone: true,
    }),
  },
  (table) => [
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: "payment_links_customer_id_fkey",
    }).onDelete("set null"),
    unique("payment_links_mode_mollie_payment_link_id_key").on(
      table.mode,
      table.molliePaymentLinkId,
    ),
    check("payment_links_amount_value_check", sql`${table.amountValue} >= 0`),
    index("payment_links_customer_idx").on(table.customerId),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    severity: alertSeverityEnum("severity").notNull(),
    status: alertStatusEnum("status").notNull().default("open"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    customerId: text("customer_id"),
    subscriptionId: text("subscription_id"),
    paymentId: text("payment_id"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    emailSentAt: timestamp("email_sent_at", {
      mode: "string",
      withTimezone: true,
    }),
    acknowledgedAt: timestamp("acknowledged_at", {
      mode: "string",
      withTimezone: true,
    }),
    resolvedAt: timestamp("resolved_at", {
      mode: "string",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: "alerts_customer_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.subscriptionId],
      foreignColumns: [subscriptions.id],
      name: "alerts_subscription_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payments.id],
      name: "alerts_payment_id_fkey",
    }).onDelete("set null"),
    index("alerts_status_idx").on(
      table.status,
      table.severity,
      table.createdAt.desc(),
    ),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorKind: actorKindEnum("actor_kind").notNull(),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    mode: mollieModeEnum("mode"),
    outcome: auditOutcomeEnum("outcome").notNull(),
    summary: text("summary").notNull(),
    details: jsonb("details")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_logs_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt.desc(),
    ),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    mode: mollieModeEnum("mode").notNull(),
    webhookSource: text("webhook_source").notNull().default("mollie"),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    topic: text("topic"),
    requestId: text("request_id"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    processingStatus: webhookProcessingStatusEnum("processing_status")
      .notNull()
      .default("pending"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),
    receivedAt: timestamp("received_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    lastAttemptAt: timestamp("last_attempt_at", {
      mode: "string",
      withTimezone: true,
    }),
    processedAt: timestamp("processed_at", {
      mode: "string",
      withTimezone: true,
    }),
  },
  (table) => [
    index("webhook_events_status_idx").on(
      table.processingStatus,
      table.receivedAt.desc(),
    ),
  ],
);
