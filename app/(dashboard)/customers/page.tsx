import { CustomerPageContent } from "./customers-page";

export default async function CustomersPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  return <CustomerPageContent searchParams={searchParams} />;
}
