import type { ReactNode } from "react";

import type { PDDRecord } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// shell + row split so the shell (headers, no data) is part of the static
// prerender and each row is its own cached unit - one component taking
// records: PDDRecord[] would mean one cache entry for all ten records

function actionVariant(actionTaken: string): "destructive" | "warning" | "secondary" {
  const lower = actionTaken.toLowerCase();
  if (lower.includes("permanently")) return "destructive";
  if (lower.includes("suspended")) return "warning";
  return "secondary";
}

// Sport Affiliation, Misconduct and Additional Details are hidden below
// sm - on a phone those three plus Name/City/State/Action Taken forced
// horizontal scrolling just to see who a row was even about. Name, City,
// State and Action Taken alone fit without scrolling; the rest are one
// screen-width scroll away, not gone
const HIDDEN_ON_MOBILE = "hidden sm:table-cell";

export function RecordsTable({ children }: { children: ReactNode }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>City</TableHead>
          <TableHead>State</TableHead>
          <TableHead className={HIDDEN_ON_MOBILE}>Sport Affiliation(s)</TableHead>
          <TableHead className={HIDDEN_ON_MOBILE}>Misconduct</TableHead>
          <TableHead>Action Taken</TableHead>
          <TableHead className={HIDDEN_ON_MOBILE}>Additional Details</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

export function RecordRow({ record }: { record: PDDRecord }) {
  return (
    <TableRow>
      <TableCell className="font-medium whitespace-nowrap">{record.name}</TableCell>
      <TableCell className="whitespace-nowrap">{record.city}</TableCell>
      <TableCell>
        <Badge variant="outline">{record.state}</Badge>
      </TableCell>
      <TableCell className={`whitespace-nowrap ${HIDDEN_ON_MOBILE}`}>
        {record.sportAffiliation}
      </TableCell>
      <TableCell className={`whitespace-nowrap ${HIDDEN_ON_MOBILE}`}>
        {record.misconduct}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <Badge variant={actionVariant(record.actionTaken)}>{record.actionTaken}</Badge>
      </TableCell>
      <TableCell
        className={`max-w-xs text-sm text-muted-foreground whitespace-normal ${HIDDEN_ON_MOBILE}`}
      >
        {record.additionalDetails ?? ""}
      </TableCell>
    </TableRow>
  );
}

// stays visible after invalidating one tag - seeing exactly one row go
// back to a skeleton is the clearest proof the invalidation was targeted
export function RecordRowSkeleton() {
  return (
    <TableRow>
      <TableCell>
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
      </TableCell>
      <TableCell>
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
      </TableCell>
      <TableCell>
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
      </TableCell>
      <TableCell className={HIDDEN_ON_MOBILE}>
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
      </TableCell>
      <TableCell className={HIDDEN_ON_MOBILE}>
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
      </TableCell>
      <TableCell>
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
      </TableCell>
      <TableCell className={HIDDEN_ON_MOBILE}>
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
      </TableCell>
    </TableRow>
  );
}

export function RecordsTableEmpty({ message }: { message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
        {message}
      </TableCell>
    </TableRow>
  );
}
