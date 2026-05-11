import { sendTestAlertAction } from "@/lib/reliability/actions";
import { getSingleSearchParam } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const resolvedSearchParams = await searchParams;
  const error = getSingleSearchParam(resolvedSearchParams.error) ?? null;
  const notice = getSingleSearchParam(resolvedSearchParams.notice) ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert>
          <AlertTitle>Updated</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="mt-2 text-muted-foreground">SMTP diagnostics and basic system actions.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Send a test notification email to verify SMTP delivery and preview the alert template.
          </p>
          <form action={sendTestAlertAction}>
            <input type="hidden" name="returnTo" value="/settings" />
            <Button type="submit">Send test email</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
