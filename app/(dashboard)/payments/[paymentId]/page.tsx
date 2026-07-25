import { PaymentPageContent } from "../payments-page";

export const dynamic = "force-dynamic";

export default async function PaymentDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ paymentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const { paymentId } = await params;

  return <PaymentPageContent paymentId={paymentId} searchParams={searchParams} />;
}
