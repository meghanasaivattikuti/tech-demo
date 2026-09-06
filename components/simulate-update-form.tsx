"use client";

import { useActionState } from "react";

import { simulateSanctionUpdate, type SimulateResult } from "@/app/actions";
import { ALLOWED_ACTIONS, suggestNextAction } from "@/lib/sanctions";
import { Button } from "@/components/ui/button";

export function SimulateUpdateForm({
  recordId,
  currentActionTaken,
}: {
  recordId: string;
  currentActionTaken: string;
}) {
  const [state, formAction, isPending] = useActionState<SimulateResult, FormData>(
    simulateSanctionUpdate,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="recordId" value={recordId} />

      <div className="space-y-1.5">
        <label htmlFor={`action-${recordId}`} className="text-sm text-muted-foreground">
          New action taken
        </label>
        {/* select, not free text - this is a public write path, six known
            values is exactly what the server will accept anyway */}
        <select
          id={`action-${recordId}`}
          name="actionTaken"
          defaultValue={suggestNextAction(currentActionTaken)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:w-56"
        >
          {ALLOWED_ACTIONS.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Writing to the database..." : "Simulate: sanction updated"}
      </Button>

      {state !== null && state.ok && (
        <span className="text-sm text-muted-foreground">
          Written to RDS. {recordId} is now{" "}
          <span className="font-medium text-foreground">{state.actionTaken}</span>.
        </span>
      )}
      {state !== null && !state.ok && (
        <span className="text-sm text-destructive" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}
