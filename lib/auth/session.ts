import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";

export const getViewerSession = cache(async () => auth());

export const requireViewerSession = cache(async () => {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/login");
  }

  return session;
});
