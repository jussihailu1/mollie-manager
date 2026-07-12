import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getViewerSession } from "@/lib/auth/session";
import { getSetupStatus } from "@/lib/env";
import { getTenantAccessForOperatorEmail } from "@/lib/tenants";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const authErrorMessages: Record<string, string> = {
  AccessDenied:
    "This Google account is signed in, but it does not have tenant or platform access yet.",
  Configuration: "Google sign-in is not configured correctly yet.",
  OAuthAccountNotLinked: "This Google account could not be linked to the current session.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  const errorCode = Array.isArray(resolvedSearchParams.error)
    ? resolvedSearchParams.error[0]
    : resolvedSearchParams.error;
  const session = await getViewerSession();

  if (session?.user?.email) {
    const access = await getTenantAccessForOperatorEmail(session.user.email);

    if (access.isPlatformOperator || access.tenantIds.length > 0) {
      redirect("/");
    }
  }

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
          signedInEmail={session?.user?.email ?? null}
        />
      </div>
    </div>
  );
}
