// Consume every page before persistence, so a partial provider failure cannot
// be mistaken for a complete subscription reconciliation.
export async function collectSubscriptionPayments<T>(
  payments: AsyncIterable<T>,
  isExpectedPayment?: (payment: T) => boolean,
) {
  const result: T[] = [];
  for await (const payment of payments) {
    if (isExpectedPayment && !isExpectedPayment(payment)) {
      throw new Error("Subscription payment ownership or mode does not match.");
    }
    result.push(payment);
  }
  return result;
}
