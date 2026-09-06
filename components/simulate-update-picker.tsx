"use client";

import { useState } from "react";

import type { PDDRecord } from "@/lib/db";
import { SimulateUpdateForm } from "@/components/simulate-update-form";

// records are already fetched server-side, so switching the dropdown is
// just picking an array index, no fetch happens until the button is clicked
export function SimulateUpdatePicker({ records }: { records: PDDRecord[] }) {
  const [selectedId, setSelectedId] = useState(records[0]?.id ?? "");
  const selected = records.find((record) => record.id === selectedId) ?? records[0];

  if (!selected) return null;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="simulate-record" className="text-sm text-muted-foreground">
          Record to update
        </label>
        <select
          id="simulate-record"
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          className="h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:max-w-xs"
        >
          {records.map((record) => (
            <option key={record.id} value={record.id}>
              {record.name} &middot; {record.city}, {record.state}
            </option>
          ))}
        </select>
      </div>

      <p className="text-sm text-muted-foreground">
        Look for <span className="font-medium text-foreground">{selected.name}</span> in
        the table below - that row is the one that will change.
      </p>

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Record</dt>
          <dd>
            <span className="font-medium">{selected.name}</span>
            <span className="block font-mono text-xs text-muted-foreground">
              {selected.id} &middot; {selected.city}, {selected.state}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Current action taken</dt>
          <dd className="font-medium">{selected.actionTaken}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last written to the database</dt>
          <dd className="font-mono text-xs">{selected.updatedAt}</dd>
        </div>
      </dl>

      {/* keyed by id so switching records doesn't leave a stale success/error
          message from the previous one showing */}
      <SimulateUpdateForm
        key={selected.id}
        recordId={selected.id}
        currentActionTaken={selected.actionTaken}
      />

      <p className="text-xs text-muted-foreground">
        Invalidates <span className="font-mono">record-{selected.id}</span> only. The
        record index and the other nine records are not touched, which is the difference
        between this and a blanket 300-second TTL where one change makes everything
        stale at once.
      </p>
    </div>
  );
}
