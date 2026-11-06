// Always inspect every provider page before creating. This also repairs a lost
// response/local save after Mollie accepted a previous request or legacy key.
export async function findOrCreateActivationSubscription<
  T extends { id: string; customerId: string; mode?: string; status: string; metadata?: unknown }, R,
>(input: {
  consentId: string;
  customerId: string;
  mode: string;
  request: R;
  list: () => AsyncIterable<T>;
  create: (request: R) => Promise<T>;
}): Promise<T> {
  const matches: T[] = [];
  for await (const subscription of input.list()) {
    if (subscription.customerId !== input.customerId || (subscription.mode && subscription.mode !== input.mode)) {
      throw new Error("Subscription ownership or mode mismatch.");
    }
    const metadata = subscription.metadata as { consentId?: string } | null;
    if (metadata?.consentId === input.consentId) matches.push(subscription);
    else if (["active", "pending", "suspended"].includes(subscription.status)) {
      throw new Error("An existing Mollie subscription needs reconciliation before activation.");
    }
  }
  if (matches.length > 1) throw new Error("Multiple Mollie subscriptions match this consent; review required.");
  if (matches[0]) {
    if (!["active", "pending"].includes(matches[0].status)) throw new Error("Existing consent subscription is no longer active; review required.");
    return matches[0];
  }
  return input.create(input.request);
}
