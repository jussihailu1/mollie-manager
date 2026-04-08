"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireViewerSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { dashboardModeCookieName } from "@/lib/dashboard-mode";

const setSelectedModeSchema = z.object({
  mode: z.enum(["test", "live"]),
  returnTo: z.string().trim().startsWith("/").default("/"),
});

export async function setSelectedMollieModeAction(formData: FormData) {
  const parsed = setSelectedModeSchema.safeParse({
    mode: formData.get("mode"),
    returnTo: formData.get("returnTo") || "/",
  });

  if (!parsed.success) {
    redirect("/");
  }

  await requireViewerSession();

  const cookieStore = await cookies();

  cookieStore.set(dashboardModeCookieName, parsed.data.mode, {
    httpOnly: true,
    maxAge: 31_536_000,
    path: "/",
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
  });

  revalidatePath(parsed.data.returnTo);
  redirect(parsed.data.returnTo);
}
