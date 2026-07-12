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
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const mollieModeEnum = pgEnum("mollie_mode", ["test", "live"]);

export const customerAccountingLinkStatusEnum = pgEnum(
  "customer_accounting_link_status",
  [
    "linked",
    "unlinked",
    "needs_review",
    "sync_error",
  ],
);

export const invoiceProviderEnum = pgEnum("invoice_provider", [
  "eboekhouden",
  "mollie",
]);

export const invoiceOwnerTypeEnum = pgEnum("invoice_owner_type", [
  "payment",
  "recurring_schedule",
]);

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

export const customerPaymentNotificationStatusEnum = pgEnum(
  "customer_payment_notification_status",
  ["claimed", "sent", "failed", "skipped"],
);

export const customerPaymentNotificationTypeEnum = pgEnum(
  "customer_payment_notification_type",
  ["failed_payment"],
);

export const customerNoteSourceEnum = pgEnum("customer_note_source", [
  "operator",
  "legacy_customer_notes",
]);

export const subscriptionTermModeEnum = pgEnum("subscription_term_mode", [
  "open_ended",
  "fixed_term",
]);

export const cancellationEffectEnum = pgEnum("cancellation_effect", [
  "immediate",
  "end_of_paid_period",
]);

export const subscriptionOperationEnum = pgEnum("subscription_operation", [
  "cancel",
  "pause",
  "resume",
]);

export const subscriptionOperationRequestStatusEnum = pgEnum(
  "subscription_operation_request_status",
  ["pending", "scheduled", "processing", "applied", "failed", "withdrawn"],
);

export const firstPaymentModeEnum = pgEnum("first_payment_mode", [
  "real_installment",
  "mandate_only",
]);

export const recurringCollectionStateEnum = pgEnum(
  "recurring_collection_state",
  [
    "not_applicable",
    "settled",
    "pending_return_window",
    "failed_needs_review",
    "mandate_problem_review",
    "reversal_critical_review",
  ],
);

export const recurringBillingInvoiceStateEnum = pgEnum(
  "recurring_billing_invoice_state",
  [
    "pending_invoice",
    "invoice_creating",
    "invoice_created",
    "invoice_sent",
    "invoice_failed",
    "skipped",
    "canceled",
  ],
);

export const paymentInvoiceStateEnum = pgEnum("payment_invoice_state", [
  "not_applicable",
  "pending_invoice",
  "invoice_creating",
  "invoice_created",
  "invoice_sent",
  "invoice_failed",
  "skipped",
]);

export const invoiceEmailDeliveryModeEnum = pgEnum(
  "invoice_email_delivery_mode",
  ["app_smtp", "eboekhouden", "none"],
);

export const tenants = pgTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
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
  (table) => [unique("tenants_slug_key").on(table.slug)],
);

export const platformOperators = pgTable(
  "platform_operators",
  {
    id: text("id").primaryKey(),
    operatorEmail: text("operator_email").notNull(),
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
    unique("platform_operators_operator_email_key").on(table.operatorEmail),
  ],
);

export const operatorTenantMemberships = pgTable(
  "operator_tenant_memberships",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    operatorEmail: text("operator_email").notNull(),
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
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "operator_tenant_memberships_tenant_id_fkey",
    }).onDelete("cascade"),
    unique("operator_tenant_memberships_tenant_email_key").on(
      table.tenantId,
      table.operatorEmail,
    ),
    index("operator_tenant_memberships_email_idx").on(table.operatorEmail),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
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
    archivedAt: timestamp("archived_at", {
      mode: "string",
      withTimezone: true,
    }),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "customers_tenant_id_fkey",
    }).onDelete("cascade"),
    unique("customers_mode_mollie_customer_id_key").on(
      table.tenantId,
      table.mode,
      table.mollieCustomerId,
    ),
    index("customers_tenant_mode_email_idx").on(
      table.tenantId,
      table.mode,
      table.email,
    ),
    index("customers_tenant_mode_archived_at_idx").on(
      table.tenantId,
      table.mode,
      table.archivedAt,
    ),
  ],
);

export const mandates = pgTable(
  "mandates",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
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
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "mandates_tenant_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: "mandates_customer_id_fkey",
    }).onDelete("cascade"),
    unique("mandates_mode_mollie_mandate_id_key").on(
      table.tenantId,
      table.mode,
      table.mollieMandateId,
    ),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
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
    subscriptionTermMode: subscriptionTermModeEnum("subscription_term_mode")
      .notNull()
      .default("open_ended"),
    totalPayments: integer("total_payments"),
    lastChargeDate: date("last_charge_date", { mode: "string" }),
    serviceEndAt: timestamp("service_end_at", {
      mode: "string",
      withTimezone: true,
    }),
    cancellationEffect: cancellationEffectEnum("cancellation_effect")
      .notNull()
      .default("end_of_paid_period"),
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
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "subscriptions_tenant_id_fkey",
    }).onDelete("cascade"),
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
      table.tenantId,
      table.mode,
      table.mollieSubscriptionId,
    ),
    check("subscriptions_amount_value_check", sql`${table.amountValue} >= 0`),
    check("subscriptions_total_payments_positive_check", sql`
      ${table.totalPayments} is null or ${table.totalPayments} > 0
    `),
    check("subscriptions_term_mode_total_payments_check", sql`
      (
        ${table.subscriptionTermMode} = 'fixed_term'
        and ${table.totalPayments} is not null
      ) or (
        ${table.subscriptionTermMode} = 'open_ended'
        and ${table.totalPayments} is null
      )
    `),
    index("subscriptions_tenant_customer_idx").on(
      table.tenantId,
      table.customerId,
      table.localStatus,
    ),
  ],
);

export const subscriptionOperationRequests = pgTable(
  "subscription_operation_requests",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    mode: mollieModeEnum("mode").notNull(),
    subscriptionId: text("subscription_id").notNull(),
    operation: subscriptionOperationEnum("operation").notNull(),
    status: subscriptionOperationRequestStatusEnum("status")
      .notNull()
      .default("pending"),
    operatorReason: text("operator_reason").notNull(),
    requestedEffectiveAt: timestamp("requested_effective_at", {
      mode: "string",
      withTimezone: true,
    }).notNull(),
    paidPeriodEndAt: timestamp("paid_period_end_at", {
      mode: "string",
      withTimezone: true,
    }),
    cancellationEffect: cancellationEffectEnum("cancellation_effect").notNull(),
    policyReasonCode: text("policy_reason_code").notNull(),
    providerMutationRequirement: text(
      "provider_mutation_requirement",
    ).notNull(),
    requestedByEmail: text("requested_by_email"),
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
    processingAt: timestamp("processing_at", {
      mode: "string",
      withTimezone: true,
    }),
    appliedAt: timestamp("applied_at", {
      mode: "string",
      withTimezone: true,
    }),
    failedAt: timestamp("failed_at", {
      mode: "string",
      withTimezone: true,
    }),
    withdrawnAt: timestamp("withdrawn_at", {
      mode: "string",
      withTimezone: true,
    }),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "subscription_operation_requests_tenant_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.subscriptionId],
      foreignColumns: [subscriptions.id],
      name: "subscription_operation_requests_subscription_id_fkey",
    }).onDelete("cascade"),
    check(
      "subscription_operation_requests_operator_reason_not_blank_check",
      sql`length(btrim(${table.operatorReason})) > 0`,
    ),
    check(
      "subscription_operation_requests_operator_reason_length_check",
      sql`length(${table.operatorReason}) <= 1000`,
    ),
    check(
      "subscription_operation_requests_cancellation_dates_check",
      sql`
        ${table.operation} <> 'cancel'
        or (
          ${table.cancellationEffect} = 'immediate'
          and ${table.paidPeriodEndAt} is null
        )
        or (
          ${table.cancellationEffect} = 'end_of_paid_period'
          and ${table.paidPeriodEndAt} is not null
          and ${table.paidPeriodEndAt} >= ${table.requestedEffectiveAt}
        )
      `,
    ),
    uniqueIndex("subscription_operation_requests_unresolved_key")
      .on(table.tenantId, table.subscriptionId, table.operation)
      .where(sql`${table.status} in ('pending', 'scheduled', 'processing')`),
  ],
);

export const tenantSubscriptionPolicyDefaults = pgTable(
  "tenant_subscription_policy_defaults",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    cancellationEmail: text("cancellation_email").notNull(),
    termsUrl: text("terms_url").notNull(),
    privacyUrl: text("privacy_url").notNull(),
    termsVersion: text("terms_version").notNull(),
    defaultCancellationEffect: cancellationEffectEnum(
      "default_cancellation_effect",
    )
      .notNull()
      .default("end_of_paid_period"),
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
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "tenant_subscription_policy_defaults_tenant_id_fkey",
    }).onDelete("cascade"),
    unique("tenant_subscription_policy_defaults_tenant_id_key").on(
      table.tenantId,
    ),
  ],
);

export const tenantBillingSettings = pgTable(
  "tenant_billing_settings",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    activeInvoiceProvider: invoiceProviderEnum("active_invoice_provider")
      .notNull()
      .default("mollie"),
    vatCode: text("vat_code").notNull().default("HOOG_VERK_21"),
    vatPercentage: numeric("vat_percentage", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("21.00"),
    invoiceLineDescriptionSource: text("invoice_line_description_source")
      .notNull()
      .default("subscription_description"),
    invoiceEmailDeliveryMode: invoiceEmailDeliveryModeEnum(
      "invoice_email_delivery_mode",
    )
      .notNull()
      .default("app_smtp"),
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
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "tenant_billing_settings_tenant_id_fkey",
    }).onDelete("cascade"),
    unique("tenant_billing_settings_tenant_id_key").on(table.tenantId),
  ],
);

export const tenantEboekhoudenInvoiceSettings = pgTable(
  "tenant_eboekhouden_invoice_settings",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    invoiceTemplateId: integer("invoice_template_id"),
    revenueLedgerId: integer("revenue_ledger_id"),
    revenueLedgerName: text("revenue_ledger_name")
      .notNull()
      .default("Omzet abonnementen"),
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
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "tenant_eboekhouden_invoice_settings_tenant_id_fkey",
    }).onDelete("cascade"),
    unique("tenant_eboekhouden_invoice_settings_tenant_id_key").on(
      table.tenantId,
    ),
  ],
);

export const tenantEboekhoudenCredentials = pgTable(
  "tenant_eboekhouden_credentials",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    apiSource: text("api_source").notNull(),
    apiTokenCiphertext: text("api_token_ciphertext").notNull(),
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
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "tenant_eboekhouden_credentials_tenant_id_fkey",
    }).onDelete("cascade"),
    unique("tenant_eboekhouden_credentials_tenant_id_key").on(table.tenantId),
  ],
);

export const tenantMollieCredentials = pgTable(
  "tenant_mollie_credentials",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    mode: mollieModeEnum("mode").notNull(),
    apiKeyCiphertext: text("api_key_ciphertext").notNull(),
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
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "tenant_mollie_credentials_tenant_id_fkey",
    }).onDelete("cascade"),
    unique("tenant_mollie_credentials_tenant_id_mode_key").on(
      table.tenantId,
      table.mode,
    ),
  ],
);

export const customerAccountingLinks = pgTable(
  "customer_accounting_links",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    customerId: text("customer_id").notNull(),
    mode: mollieModeEnum("mode").notNull(),
    provider: invoiceProviderEnum("provider").notNull(),
    providerCustomerId: text("provider_customer_id"),
    providerCustomerCode: text("provider_customer_code"),
    linkStatus: customerAccountingLinkStatusEnum("link_status")
      .notNull()
      .default("unlinked"),
    syncedAt: timestamp("synced_at", {
      mode: "string",
      withTimezone: true,
    }),
    providerSnapshot: jsonb("provider_snapshot")
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
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "customer_accounting_links_tenant_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: "customer_accounting_links_customer_id_fkey",
    }).onDelete("cascade"),
    unique("customer_accounting_links_customer_provider_key").on(
      table.tenantId,
      table.customerId,
      table.mode,
      table.provider,
    ),
    uniqueIndex("customer_accounting_links_provider_customer_id_key").on(
      table.tenantId,
      table.mode,
      table.provider,
      table.providerCustomerId,
    ),
    index("customer_accounting_links_status_idx").on(
      table.tenantId,
      table.mode,
      table.provider,
      table.linkStatus,
    ),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    mode: mollieModeEnum("mode").notNull(),
    ownerType: invoiceOwnerTypeEnum("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    provider: invoiceProviderEnum("provider").notNull(),
    providerInvoiceId: text("provider_invoice_id"),
    providerInvoiceNumber: text("provider_invoice_number"),
    providerCustomerId: text("provider_customer_id"),
    providerDocumentUrl: text("provider_document_url"),
    providerSnapshot: jsonb("provider_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    syncedAt: timestamp("synced_at", {
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
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "invoices_tenant_id_fkey",
    }).onDelete("cascade"),
    unique("invoices_owner_key").on(table.tenantId, table.ownerType, table.ownerId),
    uniqueIndex("invoices_provider_invoice_id_key").on(
      table.tenantId,
      table.mode,
      table.provider,
      table.providerInvoiceId,
    ),
    index("invoices_provider_invoice_number_idx").on(
      table.tenantId,
      table.mode,
      table.provider,
      table.providerInvoiceNumber,
    ),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
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
    recurringCollectionState: recurringCollectionStateEnum(
      "recurring_collection_state",
    )
      .notNull()
      .default("not_applicable"),
    invoiceState: paymentInvoiceStateEnum("invoice_state")
      .notNull()
      .default("not_applicable"),
    invoiceCreatedAt: timestamp("invoice_created_at", {
      mode: "string",
      withTimezone: true,
    }),
    invoiceSentAt: timestamp("invoice_sent_at", {
      mode: "string",
      withTimezone: true,
    }),
    invoiceFailedAt: timestamp("invoice_failed_at", {
      mode: "string",
      withTimezone: true,
    }),
    collectionReviewRequiredAt: timestamp("collection_review_required_at", {
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
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "payments_tenant_id_fkey",
    }).onDelete("cascade"),
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
      table.tenantId,
      table.mode,
      table.molliePaymentId,
    ),
    check("payments_amount_value_check", sql`${table.amountValue} >= 0`),
    index("payments_tenant_subscription_idx").on(
      table.tenantId,
      table.subscriptionId,
      table.paymentType,
    ),
    index("payments_tenant_recurring_collection_state_idx").on(
      table.tenantId,
      table.paymentType,
      table.recurringCollectionState,
    ),
    index("payments_tenant_invoice_state_idx").on(
      table.tenantId,
      table.mode,
      table.paymentType,
      table.invoiceState,
    ),
  ],
);

export const recurringBillingSchedules = pgTable(
  "recurring_billing_schedules",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    subscriptionId: text("subscription_id").notNull(),
    mode: mollieModeEnum("mode").notNull(),
    plannedCollectionDate: date("planned_collection_date", {
      mode: "string",
    }).notNull(),
    invoiceSendDueDate: date("invoice_send_due_date", {
      mode: "string",
    }).notNull(),
    invoiceNoticeDaysBeforeDueDate: integer(
      "invoice_notice_days_before_due_date",
    )
      .notNull()
      .default(5),
    invoiceState: recurringBillingInvoiceStateEnum("invoice_state")
      .notNull()
      .default("pending_invoice"),
    collectionState: recurringCollectionStateEnum("collection_state")
      .notNull()
      .default("not_applicable"),
    paymentId: text("payment_id"),
    amountValue: numeric("amount_value", {
      precision: 12,
      scale: 2,
    }).notNull(),
    amountCurrency: char("amount_currency", { length: 3 }).notNull(),
    billingPeriodIndex: integer("billing_period_index"),
    invoiceCreatedAt: timestamp("invoice_created_at", {
      mode: "string",
      withTimezone: true,
    }),
    invoiceSentAt: timestamp("invoice_sent_at", {
      mode: "string",
      withTimezone: true,
    }),
    invoiceFailedAt: timestamp("invoice_failed_at", {
      mode: "string",
      withTimezone: true,
    }),
    collectionResolvedAt: timestamp("collection_resolved_at", {
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
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "recurring_billing_schedules_tenant_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.subscriptionId],
      foreignColumns: [subscriptions.id],
      name: "recurring_billing_schedules_subscription_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payments.id],
      name: "recurring_billing_schedules_payment_id_fkey",
    }).onDelete("set null"),
    unique("recurring_billing_schedules_subscription_date_key").on(
      table.subscriptionId,
      table.plannedCollectionDate,
    ),
    check(
      "recurring_billing_schedules_notice_days_check",
      sql`${table.invoiceNoticeDaysBeforeDueDate} > 0`,
    ),
    check(
      "recurring_billing_schedules_amount_value_check",
      sql`${table.amountValue} >= 0`,
    ),
    index("recurring_billing_schedules_tenant_due_idx").on(
      table.tenantId,
      table.mode,
      table.invoiceState,
      table.invoiceSendDueDate,
    ),
    index("recurring_billing_schedules_tenant_subscription_idx").on(
      table.tenantId,
      table.subscriptionId,
      table.plannedCollectionDate,
    ),
  ],
);

export const paymentLinks = pgTable(
  "payment_links",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
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
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "payment_links_tenant_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: "payment_links_customer_id_fkey",
    }).onDelete("set null"),
    unique("payment_links_mode_mollie_payment_link_id_key").on(
      table.tenantId,
      table.mode,
      table.molliePaymentLinkId,
    ),
    check("payment_links_amount_value_check", sql`${table.amountValue} >= 0`),
    index("payment_links_tenant_customer_idx").on(
      table.tenantId,
      table.customerId,
    ),
  ],
);

export const subscriptionOnboardingConsents = pgTable(
  "subscription_onboarding_consents",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    mode: mollieModeEnum("mode").notNull(),
    customerId: text("customer_id").notNull(),
    paymentLinkId: text("payment_link_id").notNull(),
    consentToken: text("consent_token"),
    consentTokenHash: text("consent_token_hash"),
    consentTokenCiphertext: text("consent_token_ciphertext"),
    firstPaymentMode: firstPaymentModeEnum("first_payment_mode").notNull(),
    termsVersion: text("terms_version").notNull(),
    requiredCheckboxKeys: jsonb("required_checkbox_keys")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    acceptedCheckboxKeys: jsonb("accepted_checkbox_keys")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    planSnapshot: jsonb("plan_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    acceptedAt: timestamp("accepted_at", {
      mode: "string",
      withTimezone: true,
    }),
    acceptedIp: text("accepted_ip"),
    acceptedUserAgent: text("accepted_user_agent"),
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
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "subscription_onboarding_consents_tenant_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: "subscription_onboarding_consents_customer_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.paymentLinkId],
      foreignColumns: [paymentLinks.id],
      name: "subscription_onboarding_consents_payment_link_id_fkey",
    }).onDelete("cascade"),
    unique("subscription_onboarding_consents_consent_token_key").on(
      table.consentToken,
    ),
    unique("subscription_onboarding_consents_consent_token_hash_key").on(
      table.consentTokenHash,
    ),
    unique("subscription_onboarding_consents_mode_payment_link_id_key").on(
      table.tenantId,
      table.mode,
      table.paymentLinkId,
    ),
    check(
      "subscription_onboarding_consents_token_storage_check",
      sql`(
        (${table.consentTokenHash} is null and ${table.consentTokenCiphertext} is null and ${table.consentToken} is not null)
        or (${table.consentTokenHash} is not null and ${table.consentTokenCiphertext} is not null)
      )`,
    ),
    index("subscription_onboarding_consents_tenant_customer_idx").on(
      table.tenantId,
      table.customerId,
      table.createdAt.desc(),
    ),
  ],
);

export const customerNotes = pgTable(
  "customer_notes",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    mode: mollieModeEnum("mode").notNull(),
    customerId: text("customer_id").notNull(),
    body: text("body").notNull(),
    source: customerNoteSourceEnum("source").notNull().default("operator"),
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
    archivedAt: timestamp("archived_at", {
      mode: "string",
      withTimezone: true,
    }),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "customer_notes_tenant_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: "customer_notes_customer_id_fkey",
    }).onDelete("cascade"),
    check("customer_notes_body_not_blank_check", sql`length(btrim(${table.body})) > 0`),
    index("customer_notes_tenant_customer_created_idx").on(
      table.tenantId,
      table.customerId,
      table.createdAt.desc(),
    ),
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
    uniqueIndex("alerts_unresolved_title_entity_key")
      .on(
        table.title,
        sql`coalesce(${table.paymentId}, '')`,
        sql`coalesce(${table.subscriptionId}, '')`,
      )
      .where(sql`${table.status} in ('open', 'acknowledged')`),
  ],
);

export const customerPaymentNotifications = pgTable(
  "customer_payment_notifications",
  {
    id: text("id").primaryKey(),
    mode: mollieModeEnum("mode").notNull(),
    notificationType: customerPaymentNotificationTypeEnum("notification_type")
      .notNull()
      .default("failed_payment"),
    status: customerPaymentNotificationStatusEnum("status")
      .notNull()
      .default("claimed"),
    customerId: text("customer_id"),
    paymentId: text("payment_id").notNull(),
    subscriptionId: text("subscription_id"),
    recipientEmail: text("recipient_email"),
    subject: text("subject"),
    outcomeState: text("outcome_state").notNull(),
    outcomeReason: text("outcome_reason").notNull(),
    templateVersion: integer("template_version").notNull().default(1),
    attemptCount: integer("attempt_count").notNull().default(0),
    claimToken: text("claim_token"),
    claimedAt: timestamp("claimed_at", {
      mode: "string",
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", {
      mode: "string",
      withTimezone: true,
    }),
    failedAt: timestamp("failed_at", {
      mode: "string",
      withTimezone: true,
    }),
    lastErrorMessage: text("last_error_message"),
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
      name: "customer_payment_notifications_customer_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payments.id],
      name: "customer_payment_notifications_payment_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.subscriptionId],
      foreignColumns: [subscriptions.id],
      name: "customer_payment_notifications_subscription_id_fkey",
    }).onDelete("set null"),
    unique("customer_payment_notifications_mode_payment_type_key").on(
      table.mode,
      table.paymentId,
      table.notificationType,
    ),
    index("customer_payment_notifications_status_idx").on(
      table.status,
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
