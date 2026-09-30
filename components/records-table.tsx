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

// TableCell bakes whitespace-nowrap into every cell (components/ui/table.tsx),
// which is what actually made this table unable to fit a phone: a nowrap cell
// can't shrink below its own text, so the four visible columns had a hard
// minimum width of roughly 480px no matter what the viewport was. worse, that
// minimum only exists once the real rows arrive - the skeleton's placeholder
// bars have no intrinsic width at all - so the table sized itself narrow while
// loading and then jumped wider the moment data streamed in. letting these
// cells wrap on mobile removes the hard minimum entirely, so there's no jump
// and no sideways scrolling. nowrap comes back at sm and up, where the columns
// have room to sit on one line anyway
const WRAP_ON_MOBILE = "whitespace-normal sm:whitespace-nowrap";

// no explicit min-width anywhere in here on purpose - Card is a flex column
// (components/ui/card.tsx) and CardContent is a flex item, so a min-width set
// on a cell does not stay contained to the table's own overflow-x-auto scroll
// area. it forces the flex item, and with it the entire page, wider than the
// screen on a phone
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
      <TableCell className={`font-medium ${WRAP_ON_MOBILE}`}>{record.name}</TableCell>
      <TableCell className={WRAP_ON_MOBILE}>{record.city}</TableCell>
      <TableCell>
        <Badge variant="outline">{record.state}</Badge>
      </TableCell>
      <TableCell className={`whitespace-nowrap ${HIDDEN_ON_MOBILE}`}>
        {record.sportAffiliation}
      </TableCell>
      <TableCell className={`whitespace-nowrap ${HIDDEN_ON_MOBILE}`}>
        {record.misconduct}
      </TableCell>
      <TableCell className={WRAP_ON_MOBILE}>
        {/* Badge itself carries whitespace-nowrap and a fixed h-5, so it needs
            both overridden or "Permanently Ineligible" keeps the cell from
            shrinking and then gets clipped by the badge's overflow-hidden */}
        <Badge
          variant={actionVariant(record.actionTaken)}
          className={`${WRAP_ON_MOBILE} h-auto sm:h-5`}
        >
          {record.actionTaken}
        </Badge>
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
