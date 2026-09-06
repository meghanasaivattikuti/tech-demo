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

export function RecordsTable({ children }: { children: ReactNode }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>City</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Sport Affiliation(s)</TableHead>
          <TableHead>Misconduct</TableHead>
          <TableHead>Action Taken</TableHead>
          <TableHead>Additional Details</TableHead>
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
      <TableCell className="whitespace-nowrap">{record.sportAffiliation}</TableCell>
      <TableCell className="whitespace-nowrap">{record.misconduct}</TableCell>
      <TableCell className="whitespace-nowrap">
        <Badge variant={actionVariant(record.actionTaken)}>{record.actionTaken}</Badge>
      </TableCell>
      <TableCell className="max-w-xs text-sm text-muted-foreground whitespace-normal">
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
      {Array.from({ length: 7 }).map((_, index) => (
        <TableCell key={index}>
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
        </TableCell>
      ))}
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
