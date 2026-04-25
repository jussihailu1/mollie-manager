export type MpCustomerStatus =
  | "new"
  | "payment_pending"
  | "payment_completed"
  | "subscription_active";

export type MpCustomer = {
  address: string | null;
  businessName: string;
  contactName: string;
  createdAt: string;
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
  mode: "live" | "test";
  notes: string | null;
  phone: string | null;
  subscriptionCount: number;
};

export type MpPayment = {
  amount: string;
  createdAt: string;
  customerBusinessName: string;
  customerId: string;
  description: string;
  id: string;
  paidAt: string | null;
  status: "pending" | "paid" | "failed" | "expired";
  type: "first" | "recurring";
};

export type MpNotification = {
  createdAt: string;
  customerId?: string;
  id: string;
  message: string;
  read: boolean;
  title: string;
  type: "payment_completed" | "payment_failed" | "subscription_created" | "info";
};

export type MpActivity = {
  description: string;
  id: string;
  timestamp: string;
};

export const mpCustomers: MpCustomer[] = [
  {
    address: null,
    businessName: "Johnson & Co",
    contactName: "Alice Johnson",
    createdAt: "2026-04-14T09:00:00.000Z",
    email: "alice@johnsonco.com",
    hasValidMandate: false,
    id: "mp-customer-1",
    latestFirstPaymentCheckoutUrl: null,
    latestFirstPaymentLinkStatus: null,
    latestFirstPaymentLinkUrl: null,
    latestFirstPaymentPaidAt: null,
    latestFirstPaymentStatus: null,
    latestMandateStatus: null,
    latestSubscriptionStatus: null,
    mode: "live",
    notes: null,
    phone: null,
    subscriptionCount: 0,
  },
  {
    address: null,
    businessName: "Smith Industries",
    contactName: "Bob Smith",
    createdAt: "2026-04-11T09:00:00.000Z",
    email: "bob@smithindustries.com",
    hasValidMandate: false,
    id: "mp-customer-2",
    latestFirstPaymentCheckoutUrl: "https://mollie.com/pay/mock_2",
    latestFirstPaymentLinkStatus: "open",
    latestFirstPaymentLinkUrl: "https://mollie.com/pay/mock_2",
    latestFirstPaymentPaidAt: null,
    latestFirstPaymentStatus: null,
    latestMandateStatus: "pending",
    latestSubscriptionStatus: null,
    mode: "live",
    notes: null,
    phone: null,
    subscriptionCount: 0,
  },
  {
    address: null,
    businessName: "Davis Consulting",
    contactName: "Charlie Davis",
    createdAt: "2026-04-06T09:00:00.000Z",
    email: "charlie@davisconsulting.nl",
    hasValidMandate: true,
    id: "mp-customer-3",
    latestFirstPaymentCheckoutUrl: "https://mollie.com/pay/mock_3",
    latestFirstPaymentLinkStatus: "paid",
    latestFirstPaymentLinkUrl: "https://mollie.com/pay/mock_3",
    latestFirstPaymentPaidAt: "2026-04-06T10:00:00.000Z",
    latestFirstPaymentStatus: "paid",
    latestMandateStatus: "valid",
    latestSubscriptionStatus: null,
    mode: "live",
    notes: null,
    phone: null,
    subscriptionCount: 0,
  },
  {
    address: null,
    businessName: "Prince Digital",
    contactName: "Diana Prince",
    createdAt: "2026-03-17T09:00:00.000Z",
    email: "diana@princedigital.com",
    hasValidMandate: true,
    id: "mp-customer-4",
    latestFirstPaymentCheckoutUrl: "https://mollie.com/pay/mock_4",
    latestFirstPaymentLinkStatus: "paid",
    latestFirstPaymentLinkUrl: "https://mollie.com/pay/mock_4",
    latestFirstPaymentPaidAt: "2026-03-17T10:00:00.000Z",
    latestFirstPaymentStatus: "paid",
    latestMandateStatus: "valid",
    latestSubscriptionStatus: "active",
    mode: "live",
    notes: null,
    phone: null,
    subscriptionCount: 1,
  },
];

export const mpPayments: MpPayment[] = [
  {
    amount: "10.00",
    createdAt: "2026-04-14T09:00:00.000Z",
    customerBusinessName: "Johnson & Co",
    customerId: "mp-customer-1",
    description: "First mandate payment",
    id: "tr_mp_1",
    paidAt: null,
    status: "pending",
    type: "first",
  },
  {
    amount: "10.00",
    createdAt: "2026-04-11T09:00:00.000Z",
    customerBusinessName: "Smith Industries",
    customerId: "mp-customer-2",
    description: "First mandate payment",
    id: "tr_mp_2",
    paidAt: null,
    status: "pending",
    type: "first",
  },
  {
    amount: "10.00",
    createdAt: "2026-04-06T09:00:00.000Z",
    customerBusinessName: "Davis Consulting",
    customerId: "mp-customer-3",
    description: "First mandate payment",
    id: "tr_mp_3",
    paidAt: "2026-04-06T10:00:00.000Z",
    status: "paid",
    type: "first",
  },
  {
    amount: "49.99",
    createdAt: "2026-03-17T09:00:00.000Z",
    customerBusinessName: "Prince Digital",
    customerId: "mp-customer-4",
    description: "Monthly subscription",
    id: "tr_mp_4",
    paidAt: "2026-03-17T10:00:00.000Z",
    status: "paid",
    type: "recurring",
  },
];

export const mpNotifications: MpNotification[] = [
  {
    createdAt: "2026-04-14T10:00:00.000Z",
    id: "mp-note-1",
    message: "A customer requires attention in the onboarding flow.",
    read: false,
    title: "Customer Stuck in Flow",
    type: "info",
  },
];

export const mpActivities: MpActivity[] = [
  {
    description: "Created new customer: Johnson & Co",
    id: "mp-activity-1",
    timestamp: "2026-04-14T09:00:00.000Z",
  },
  {
    description: "Generated payment link for Smith Industries (€10.00)",
    id: "mp-activity-2",
    timestamp: "2026-04-11T09:00:00.000Z",
  },
  {
    description: "Started monthly subscription for Prince Digital (€49.99)",
    id: "mp-activity-3",
    timestamp: "2026-03-17T10:00:00.000Z",
  },
];
