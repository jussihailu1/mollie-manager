import { CustomerPageContent } from "../customers-page";

export const dynamic = "force-dynamic";

type CustomerDetailPageProps = {
  params: Promise<{
    customerId: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CustomerDetailPage({
  params,
  searchParams,
}: Readonly<CustomerDetailPageProps>) {
  const { customerId } = await params;

  return <CustomerPageContent customerId={customerId} searchParams={searchParams} />;
}
