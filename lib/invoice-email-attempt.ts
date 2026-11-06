import { smtpDefinitelyDidNotAccept } from "@/lib/notifications/smtp-outcome";

export async function runInvoiceEmailAttempt(dependencies: {
  claim: () => Promise<boolean>;
  send: () => Promise<void>;
  record: (state: "accepted" | "failed" | "uncertain") => Promise<void>;
  finish: () => Promise<void>;
  report: () => void;
}) {
  if (!await dependencies.claim()) return { status: "skipped" as const, reason: "Invoice email is already sent, in progress, or awaiting delivery review." };
  try {
    await dependencies.send();
  } catch (error) {
    try { await dependencies.record(smtpDefinitelyDidNotAccept(error) ? "failed" : "uncertain"); }
    catch { dependencies.report(); } // The durable claim still prevents a replay.
    throw error;
  }
  try {
    // Persist SMTP acceptance separately from owner state/auditing. Recovery can
    // finish an accepted attempt without sending the email a second time.
    await dependencies.record("accepted");
    await dependencies.finish();
  } catch { dependencies.report(); }
  return { status: "sent" as const };
}
