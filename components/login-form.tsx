import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { appName } from "@/lib/app-config";
import { signInWithGoogle } from "@/lib/auth/actions";

type LoginFormProps = {
  authIssues: string[];
  authReady: boolean;
  className?: string;
  errorMessage?: string | null;
};

function GoogleIcon(props: React.ComponentProps<"svg">) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
      <path
        d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
        fill="currentColor"
      />
    </svg>
  );
}

export function LoginForm({
  authIssues,
  authReady,
  className,
  errorMessage,
}: LoginFormProps) {
  const brandMark = appName.slice(0, 2).toUpperCase();

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div className="flex justify-center">
        <div className="flex size-10 items-center justify-center rounded-xl border bg-card text-sm font-semibold text-foreground shadow-sm">
          {brandMark}
        </div>
      </div>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="items-center gap-3 text-center">
          <CardTitle className="text-3xl tracking-tight">Welcome to {appName}</CardTitle>
          <CardDescription className="max-w-sm text-pretty text-sm leading-6">
            Sign in with the allowlisted Google account to continue to the internal dashboard.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {errorMessage ? (
            <Alert variant="destructive">
              <AlertTitle>Sign-in failed</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          {!authReady ? (
            <Alert>
              <AlertTitle>Auth setup is incomplete</AlertTitle>
              <AlertDescription>
                <ul className="ml-4 flex list-disc flex-col gap-1">
                  {authIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <form action={signInWithGoogle} className="w-full">
            <Button
              className="w-full"
              disabled={!authReady}
              size="lg"
              type="submit"
              variant="outline"
            >
              <GoogleIcon data-icon="inline-start" />
              Continue with Google
            </Button>
          </form>
        </CardContent>

        <CardFooter className="justify-center px-6 pb-6 pt-0">
          <p className="max-w-sm text-center text-sm leading-6 text-muted-foreground">
            Access is limited to the configured owner account.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
