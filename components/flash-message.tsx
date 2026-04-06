import { cn } from "@/lib/utils";

const variantClasses = {
  error: "border-rose-500/18 bg-rose-50 text-rose-900",
  notice: "border-accent/18 bg-accent-soft text-accent-strong",
} as const;

export function FlashMessage({
  message,
  title,
  variant,
}: Readonly<{
  message: string;
  title: string;
  variant: keyof typeof variantClasses;
}>) {
  return (
    <div
      className={cn(
        "rounded-[22px] border px-4 py-3 shadow-sm",
        variantClasses[variant],
      )}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm leading-6">{message}</p>
    </div>
  );
}
