import { PaymentPageContent } from "./payments-page";

export default async function PaymentsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  return <PaymentPageContent searchParams={searchParams} />;
}
