"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function StatusRefresh({
  enabled,
}: Readonly<{
  enabled: boolean;
}>) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const intervalId = window.setInterval(() => {
      router.refresh();
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, router]);

  if (!enabled) {
    return null;
  }

  return (
    <p className="mt-4 text-xs uppercase tracking-[0.2em] text-neutral-500">
      Refreshing automatically
    </p>
  );
}
