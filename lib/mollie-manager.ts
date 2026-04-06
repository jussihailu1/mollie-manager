export const appName = "Mollie Manager";

export const dashboardNavigation = [
  {
    href: "/",
    label: "Overview",
    shortLabel: "OV",
    description: "Track the rollout, core billing flow, and safety posture.",
  },
  {
    href: "/customers",
    label: "Customers",
    shortLabel: "CU",
    description: "Prepare customer records and first-payment handoff.",
  },
  {
    href: "/subscriptions",
    label: "Subscriptions",
    shortLabel: "SU",
    description: "Create, inspect, and stop recurring billing safely.",
  },
  {
    href: "/payments",
    label: "Payments",
    shortLabel: "PY",
    description: "Monitor first payments, recurring charges, and exceptions.",
  },
  {
    href: "/payment-links",
    label: "Payment Links",
    shortLabel: "PL",
    description: "Handle standalone Mollie payment-link objects separately.",
  },
  {
    href: "/alerts",
    label: "Alerts",
    shortLabel: "AL",
    description: "Review late, failed, or disputed events that need attention.",
  },
  {
    href: "/settings",
    label: "Settings",
    shortLabel: "SE",
    description: "Configure modes, integrations, email delivery, and controls.",
  },
] as const;

export const onboardingFlow = [
  {
    title: "Customer record",
    description:
      "Create the customer once and attach the later first-payment and subscription objects to that Mollie customer ID.",
    label: "Core",
    tone: "accent",
  },
  {
    title: "First payment",
    description:
      "Issue a customer-linked first payment, restricted to iDEAL, and share the returned Mollie checkout URL manually via WhatsApp.",
    label: "Core",
    tone: "accent",
  },
  {
    title: "Mandate readiness",
    description:
      "Verify that the successful first payment established the direct debit mandate before attempting subscription creation.",
    label: "Safety",
    tone: "warning",
  },
  {
    title: "Subscription",
    description:
      "Create the monthly recurring subscription on the same billing day as the successful first installment.",
    label: "Core",
    tone: "accent",
  },
  {
    title: "Exception tracking",
    description:
      "Map Mollie resource updates to local operational states such as awaiting attention, out of sync, or future charges stopped.",
    label: "Later",
    tone: "muted",
  },
  {
    title: "Alerting",
    description:
      "Send plain email notifications to you whenever a payment fails, becomes disputed, or drifts out of the expected flow.",
    label: "Later",
    tone: "muted",
  },
] as const;

export const foundationPhases = [
  {
    title: "Phase 1",
    description:
      "App shell, navigation, domain framing, and environment contract.",
    state: "Complete",
    tone: "accent",
  },
  {
    title: "Phase 2",
    description:
      "Database, auth boundary, validated configuration, and Mollie server client.",
    state: "Complete",
    tone: "accent",
  },
  {
    title: "Phase 3",
    description:
      "Customer onboarding flow through first payment and subscription creation.",
    state: "Complete",
    tone: "accent",
  },
  {
    title: "Phase 4",
    description:
      "Management screens for subscriptions, payments, and guarded actions.",
    state: "Current",
    tone: "warning",
  },
  {
    title: "Phase 5",
    description:
      "Webhooks, reconciliation, email alerts, and operational hardening.",
    state: "Planned",
    tone: "muted",
  },
] as const;

export const foundationRails = [
  {
    title: "No client-side secrets",
    description:
      "Mollie keys and future auth secrets remain server-only. The browser sees only the UI.",
  },
  {
    title: "Operational state above payment state",
    description:
      "The app will track statuses like mandate pending or out of sync, which Mollie alone does not expose as a workflow.",
  },
  {
    title: "Write protection",
    description:
      "Destructive and money-impacting actions will require explicit confirmation and an audit entry.",
  },
  {
    title: "Webhook replayability",
    description:
      "Incoming webhooks will be stored and replayable so an intermittent failure does not lose operational history.",
  },
] as const;

export const derivedSubscriptionStates = [
  "awaiting_first_payment",
  "mandate_pending",
  "active",
  "payment_action_required",
  "future_charges_stopped",
  "charged_back",
  "out_of_sync",
] as const;

export const moduleRegistry = {
  customers: {
    eyebrow: "Customers",
    title: "Customer records and first-payment preparation",
    description:
      "This module will own customer creation, customer notes, and the inputs needed before a recurring subscription can exist safely.",
    phaseTitle: "Phase 3 and 4",
    phaseDescription:
      "This area becomes functional once the database, auth, and Mollie server client are in place.",
    phaseCallout:
      "Customer creation and the first-payment handoff will be wired together to reduce setup mistakes.",
    states: ["customer_ready", "checkout_pending", "mandate_pending"],
    capabilities: [
      "Capture legal/customer identity details and billing metadata.",
      "Generate the first payment handoff from a single, validated form.",
      "Keep internal notes that do not belong in Mollie itself.",
    ],
    notes: [
      "A customer without a successful first payment should never look subscription-ready.",
      "The app should guide you to one safe next step instead of exposing every action at once.",
    ],
    nextStep:
      "Wire the customer form to the validated database model and Mollie customer creation flow.",
  },
  subscriptions: {
    eyebrow: "Subscriptions",
    title: "Recurring billing control with guarded cancellation",
    description:
      "This module will focus on creation after mandate readiness, plus inspection and safe stop behavior for future collections.",
    phaseTitle: "Phase 3 and 4",
    phaseDescription:
      "Subscription creation depends on a completed first-payment and mandate-verification pipeline.",
    phaseCallout:
      "Default cancellation behavior will stop future charges after the current paid period unless you explicitly choose otherwise.",
    states: ["active", "future_charges_stopped", "out_of_sync"],
    capabilities: [
      "Create monthly subscriptions from verified customer and mandate context.",
      "Show raw Mollie data beside app-level operational status.",
      "Protect cancellation with confirmation and audit logging.",
    ],
    notes: [
      "The UI should separate 'view current state' from 'perform irreversible action'.",
      "App-level status needs to clarify whether the next charge is expected, blocked, or already stopped.",
    ],
    nextStep:
      "Implement the server action that creates subscriptions only when the prerequisite mandate state is valid.",
  },
  payments: {
    eyebrow: "Payments",
    title: "First installments, recurring charges, and exception handling",
    description:
      "This module will aggregate the payments that matter to subscription operations, including first authorizations and later recurring collections.",
    phaseTitle: "Phase 4 and 5",
    phaseDescription:
      "It becomes operational once payments are stored locally and webhook processing is active.",
    phaseCallout:
      "The app will always re-fetch payment state from Mollie before trusting a webhook-triggered transition.",
    states: ["pending", "paid", "failed", "charged_back"],
    capabilities: [
      "Differentiate first-payment onboarding from recurring collection outcomes.",
      "Surface failures, disputes, and state mismatches immediately.",
      "Link payment events back to their customer and subscription context.",
    ],
    notes: [
      "Payment history is financial truth in Mollie, but the app needs local history for alerts and triage.",
      "SEPA timing means 'late' should be derived with care instead of inferred from a single failed status.",
    ],
    nextStep:
      "Store payment snapshots and build the retrieval path that correlates them to subscriptions.",
  },
  "payment-links": {
    eyebrow: "Payment Links",
    title: "Standalone payment-link management for one-off use cases",
    description:
      "This module is separate from the recurring onboarding flow because Mollie payment-link objects solve a different operational problem.",
    phaseTitle: "Phase 4",
    phaseDescription:
      "It will become useful after the core recurring flow is stable.",
    phaseCallout:
      "The primary subscription setup flow should use a customer first payment, then share its checkout URL manually.",
    states: ["draft", "active", "expired"],
    capabilities: [
      "Create and inspect real Mollie payment-link objects for one-off collection scenarios.",
      "Avoid confusing standalone payment links with the recurring mandate flow.",
      "Keep expiry and shareability visible in one place.",
    ],
    notes: [
      "This section exists because the product still needs payment-link management, even though recurring onboarding uses a different object path.",
      "Keeping it separate will reduce operational mistakes when you are moving quickly.",
    ],
    nextStep:
      "Add the dedicated payment-link data model after the subscription onboarding flow is complete.",
  },
  alerts: {
    eyebrow: "Alerts",
    title: "Operational attention queue for failed or risky states",
    description:
      "This module will consolidate payment failures, chargebacks, sync drift, and email delivery state into one queue.",
    phaseTitle: "Phase 5",
    phaseDescription:
      "Alerting is only useful once the data model and webhook pipeline can drive it reliably.",
    phaseCallout:
      "Email notifications to you will stay deliberately plain; reliability matters more than presentation here.",
    states: ["new", "acknowledged", "sent", "resolved"],
    capabilities: [
      "Queue alerts before attempting email delivery.",
      "Track whether a notification was sent, retried, or failed.",
      "Let the dashboard show unresolved operational issues even if email delivery has a problem.",
    ],
    notes: [
      "Email should not be the only place an incident exists.",
      "Alerts need enough context to explain the affected customer, payment, or subscription at a glance.",
    ],
    nextStep:
      "Add durable alert records and connect them to webhook-driven payment and subscription events.",
  },
  settings: {
    eyebrow: "Settings",
    title: "Environment separation, auth, and integration controls",
    description:
      "This area will hold the operational controls that define how the app connects to Mollie, email delivery, and your own account access.",
    phaseTitle: "Phase 2",
    phaseDescription:
      "Settings becomes active once configuration validation and Google auth scaffolding are in place.",
    phaseCallout:
      "Test and live modes will be explicit and visible to reduce the chance of using the wrong key set.",
    states: ["test_mode", "live_mode", "auth_ready"],
    capabilities: [
      "Display configuration readiness without exposing secrets.",
      "Separate test and live connections clearly in the UI.",
      "Prepare the app for Google-based single-user access control.",
    ],
    notes: [
      "A dashboard that touches money needs obvious environment labeling at all times.",
      "Config should fail closed instead of guessing which key or mode to use.",
    ],
    nextStep:
      "Implement validated configuration loading and the auth boundary before any live actions are exposed.",
  },
} as const;

export type DashboardModuleId = keyof typeof moduleRegistry;
