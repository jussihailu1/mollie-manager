import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type CustomerDetailPageProps = {
  params: Promise<{
    customerId: string;
  }>;
};

export default async function CustomerDetailPage({
  params,
}: Readonly<CustomerDetailPageProps>) {
  const { customerId } = await params;

  redirect(`/customers?focus=${customerId}`);
}
