"use client";

import { useCallback, useEffect, useState } from "react";

import { getMyPendingEntries } from "@/app/actions";
import type { AuditEntry } from "@/lib/db";
import {
  useIsSimulating,
  useSimulatedRecordIds,
  useSimulateVersion,
} from "@/components/simulation-session";
import { CollapsibleCard } from "@/components/collapsible-card";
import { PendingReviewForm } from "@/components/pending-review-form";

const STAGES = ["Simulate", "Paused", "Reviewed", "Written / discarded"];

// tiny horizontal pipeline, not a real diagramming lib - four steps is
// simple enough that a flex row with arrows says it plainly. activeIndex
// highlights where the current entry (if any) actually sits right now
function WorkflowStages({ activeIndex }: { activeIndex: number | null }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {STAGES.map((stage, index) => (
        <span key={stage} className="flex items-center gap-1.5">
          <span
            className={
              index === activeIndex
                ? "rounded-full bg-primary px-2 py-0.5 font-medium text-primary-foreground"
                : "rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
            }
          >
            {stage}
          </span>
          {index < STAGES.length - 1 && (
            <span className="text-muted-foreground" aria-hidden="true">
              &rarr;
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

export function PendingReviews() {
  const simulatedRecordIds = useSimulatedRecordIds();
  const version = useSimulateVersion();
  const isSimulating = useIsSimulating();
  const [entry, setEntry] = useState<AuditEntry | null>(null);
  // "reviewing"/"written" while a review is actually in flight or just
  // resolved - reset back to null (plain "Paused") whenever the entry
  // itself changes, since that's a genuinely new, untouched run
  const [stage, setStage] = useState<"reviewing" | "written" | null>(null);

  // re-fetched whenever the set of records this browser has simulated
  // changes, and again after a review - the database has no notion of
  // "whose" a pending entry is, so this is what actually scopes it to just
  // what you triggered yourself, in this page load
  const refetch = useCallback(() => {
    if (simulatedRecordIds.length === 0) {
      setEntry(null);
      return;
    }
    void getMyPendingEntries(simulatedRecordIds).then(setEntry);
  }, [simulatedRecordIds]);

  // version is in the dependency list purely to force this to re-run on
  // every simulate, including a repeat simulate of a record already in
  // simulatedRecordIds - that case doesn't change the list itself, so
  // refetch's own identity wouldn't change without this
  useEffect(() => {
    refetch();
  }, [refetch, version]);

  useEffect(() => {
    setStage(null);
  }, [entry?.id]);

  // cleared the instant a new simulate starts, not just once the new entry
  // has actually arrived - otherwise "stage" is still whatever the
  // *previous* entry left it as (often "written") for the gap between the
  // submit finishing and the refetch resolving, which briefly shows
  // "Written / discarded" for an entry that isn't even the one just
  // simulated
  useEffect(() => {
    if (isSimulating) setStage(null);
  }, [isSimulating]);

  const activeIndex = isSimulating
    ? 0
    : entry === null
      ? null
      : stage === "reviewing"
        ? 2
        : stage === "written"
          ? 3
          : 1;

  return (
    <CollapsibleCard
      // remounts whenever which entry is shown changes, so a fresh
      // <details> always starts back at defaultOpen - true the moment a
      // simulate produces one (even if this had been manually collapsed
      // before), false once nothing's pending, rather than staying stuck
      // open or closed from whatever it was set to earlier
      key={entry?.id ?? "none"}
      title="Workflow run"
      description="The most recent simulated update pauses here until someone reviews it. It can wait for days, even through a redeploy, and pick back up right where it left off."
      defaultOpen={entry !== null}
    >
      <div className="space-y-4">
        <WorkflowStages activeIndex={activeIndex} />

        {entry === null ? (
          <p className="text-sm text-muted-foreground">
            Nothing of yours is waiting on a decision right now - simulate an update
            above to see one appear here.
          </p>
        ) : (
          <PendingReviewForm entry={entry} onStageChange={setStage} />
        )}
      </div>
    </CollapsibleCard>
  );
}
