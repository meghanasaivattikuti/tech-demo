"use client";

import { useActionState, useEffect, useRef } from "react";

import { reviewAuditEntry, type ReviewResult } from "@/app/actions";
import type { AuditEntry } from "@/lib/db";
import { Button } from "@/components/ui/button";

export function PendingReviewForm({
  entry,
  onStageChange,
}: {
  entry: AuditEntry;
  // lets the parent's stage diagram track what this form is actually doing
  // right now, not just "an entry exists"
  onStageChange: (stage: "reviewing" | "written") => void;
}) {
  const [state, formAction, isPending] = useActionState<ReviewResult, FormData>(
    reviewAuditEntry,
    null,
  );

  useEffect(() => {
    if (isPending) onStageChange("reviewing");
  }, [isPending, onStageChange]);

  const reported = useRef(false);
  useEffect(() => {
    if (state !== null && state.ok && !reported.current) {
      reported.current = true;
      onStageChange("written");
    }
  }, [state, onStageChange]);

  // shows the exact message from the Server Action (what actually happened
  // to the database, not just "decision sent") and stays put - this entry
  // only goes away once the next simulate replaces it, not on a timer
  if (state !== null && state.ok) {
    return (
      <p className="rounded-md border border-border p-3 text-sm text-foreground">
        {state.message}
      </p>
    );
  }

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-md border border-border p-3 text-sm"
    >
      <input type="hidden" name="auditId" value={entry.id} />

      {/* labeled like the dl in simulate-update-picker.tsx, for visual
          consistency between the two cards */}
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Record</dt>
          <dd className="font-mono text-sm font-medium text-foreground">
            {entry.recordId}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Requested action</dt>
          <dd className="text-sm font-medium text-foreground">{entry.actionTaken}</dd>
        </div>
      </dl>

      <div className="space-y-1.5">
        <label htmlFor={`comment-${entry.id}`} className="block text-xs text-muted-foreground">
          Reviewer comment
        </label>
        <textarea
          id={`comment-${entry.id}`}
          name="comment"
          rows={2}
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          placeholder="Optional"
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" name="decision" value="approve" disabled={isPending}>
          Approve
        </Button>
        <Button
          type="submit"
          name="decision"
          value="reject"
          variant="destructive"
          disabled={isPending}
        >
          Reject
        </Button>
      </div>

      {state !== null && !state.ok && (
        <p className="text-destructive" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
