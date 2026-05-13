import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getViewerSession } from "@/lib/auth/session";
import { getSetupStatus } from "@/lib/env";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const authErrorMessages: Record<string, string> = {
  AccessDenied: "This Google account is not allowed to access Mollie Manager.",
  Configuration: "Google sign-in is not configured correctly yet.",
  OAuthAccountNotLinked: "This Google account could not be linked to the current session.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getViewerSession();

  if (session?.user?.email) {
    redirect("/");
  }

  const resolvedSearchParams = await searchParams;
  const errorCode = Array.isArray(resolvedSearchParams.error)
    ? resolvedSearchParams.error[0]
    : resolvedSearchParams.error;
  const errorMessage = errorCode
    ? authErrorMessages[errorCode] ?? "Google sign-in could not be completed."
    : null;
  const setupStatus = getSetupStatus();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm
          authIssues={setupStatus.auth.issues}
          authReady={setupStatus.auth.ready}
          errorMessage={errorMessage}
        />
      </div>
    </div>
  );
}
