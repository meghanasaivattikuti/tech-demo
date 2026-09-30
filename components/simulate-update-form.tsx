"use client";

import { useActionState, useEffect, useRef } from "react";

import { simulateSanctionUpdate, type SimulateResult } from "@/app/actions";
import { ALLOWED_ACTIONS } from "@/lib/sanctions";
import { Button } from "@/components/ui/button";
import { addSimulatedRecordId, setSimulating } from "@/components/simulation-session";

export function SimulateUpdateForm({ recordId }: { recordId: string }) {
  const [state, formAction, isPending] = useActionState<SimulateResult, FormData>(
    simulateSanctionUpdate,
    null,
  );

  // lights up the "Simulate" stage in the Workflow run diagram for exactly
  // the span of this submit - by the time a pending entry exists there at
  // all, this submit has already finished, so nothing else can signal it
  useEffect(() => {
    setSimulating(isPending);
  }, [isPending]);

  // state is the same object reference until the next submit resolves, so
  // this only fires once per successful update, not once per render
  const lastReported = useRef<SimulateResult>(null);
  useEffect(() => {
    if (state !== null && state.ok && state !== lastReported.current) {
      lastReported.current = state;
      addSimulatedRecordId(state.recordId);
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="recordId" value={recordId} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1.5">
          <label htmlFor={`action-${recordId}`} className="text-sm text-muted-foreground">
            New action taken
          </label>
          {/* select, not free text - this is a public write path, six known
              values is exactly what the server will accept anyway. starts
              empty and required so a submission always reflects something
              actually picked, not a suggested default nobody looked at */}
          <select
            id={`action-${recordId}`}
            name="actionTaken"
            required
            defaultValue=""
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:w-56"
          >
            <option value="" disabled>
              Select an action
            </option>
            {ALLOWED_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" disabled={isPending}>
          {isPending ? "Submitting..." : "Simulate: sanction updated"}
        </Button>
      </div>

      {/* own line, not squeezed next to the button - the message can run
          long (it names the record and the proposed action), so sharing a
          row with the button just forces an awkward wrap */}
      {state !== null && state.ok && (
        <p className="text-sm text-muted-foreground">
          Submitted for approval. {recordId} will become{" "}
          <span className="font-medium text-foreground">{state.actionTaken}</span> once
          approved. Approve or reject it in Workflow run below.
        </p>
      )}
      {state !== null && !state.ok && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
