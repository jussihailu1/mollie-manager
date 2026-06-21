import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RETENTION_POLICY,
  type RetentionDataMode,
} from "@/lib/retention-policy";

function ApplicabilityBadge({
  applies,
  mode,
}: Readonly<{ applies: boolean; mode: RetentionDataMode }>) {
  return (
    <Badge
      variant={applies ? "secondary" : "outline"}
      className={applies ? "whitespace-nowrap" : "whitespace-nowrap text-muted-foreground"}
    >
      {applies ? `Applies to ${mode}` : `Not ${mode}`}
    </Badge>
  );
}

export function RetentionPolicyCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Retention policy</CardTitle>
        <CardDescription>
          Accepted retention windows and handling rules for stored operational data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          role="note"
          className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm"
        >
          <p className="font-medium">No destructive cleanup runs automatically.</p>
          <p className="mt-1 text-muted-foreground">
            These rows present the accepted policy only; they do not delete, redact, or
            anonymize data.
          </p>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data area</TableHead>
              <TableHead>Retention</TableHead>
              <TableHead>Live</TableHead>
              <TableHead>Test</TableHead>
              <TableHead>Handling after window</TableHead>
              <TableHead>Evidence impact</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {RETENTION_POLICY.map((policy) => (
              <TableRow key={policy.dataArea}>
                <TableCell className="min-w-48 font-medium">
                  {policy.dataAreaLabel}
                </TableCell>
                <TableCell className="min-w-44 whitespace-nowrap">
                  {policy.windowLabel}
                </TableCell>
                <TableCell>
                  <ApplicabilityBadge
                    applies={policy.modes.includes("live")}
                    mode="live"
                  />
                </TableCell>
                <TableCell>
                  <ApplicabilityBadge
                    applies={policy.modes.includes("test")}
                    mode="test"
                  />
                </TableCell>
                <TableCell className="min-w-64">{policy.actionLabel}</TableCell>
                <TableCell className="min-w-72 text-muted-foreground">
                  {policy.evidenceImpact}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
