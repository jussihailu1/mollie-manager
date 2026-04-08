import { InlineNotice } from "@/components/inline-notice";

export function FlashMessage({
  message,
  title,
  variant,
}: Readonly<{
  message: string;
  title: string;
  variant: "error" | "notice";
}>) {
  return <InlineNotice title={title} message={message} tone={variant} />;
}
