import { redirect } from "next/navigation";

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
