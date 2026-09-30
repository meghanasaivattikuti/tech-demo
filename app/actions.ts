"use server";

import { after } from "next/server";
import { refresh, updateTag } from "next/cache";
import { getRun, resumeHook, start } from "workflow/api";

import {
  applySanctionUpdate,
  clearOtherPendingEntries,
  finalizeAuditEntry,
  getAuditEntryForReview,
  getPendingAuditEntries,
  getRecord,
  recordAuditEntry,
  recordTag,
  type AuditEntry,
} from "@/lib/db";
import { ALLOWED_ACTIONS_SET } from "@/lib/sanctions";
import { auditSanctionUpdateWorkflow } from "@/workflows/sanction-update";

// this is public with no auth since the demo needs to be openable from a
// link, so the blast radius is the whole design here: only these 10 known
// fictional record ids, only these 6 known sanction strings, nothing
// caller-supplied ever gets written. worst case someone flips a fictional
// record between two sanction values. real writes in production come from
// the actual case-management system, this app has no write path there at all
//
// all 10 records rather than just 1, on purpose - letting the demo target
// any of them is what actually proves invalidation is per-record and not
// just a single hardcoded path
const DEMO_UPDATABLE_RECORDS = new Set([
  "PDD-1001", "PDD-1002", "PDD-1003", "PDD-1004", "PDD-1005",
  "PDD-1006", "PDD-1007", "PDD-1008", "PDD-1009", "PDD-1010",
]);

// ALLOWED_ACTIONS lives in lib/sanctions.ts instead of here - a "use
// server" file can only export async server actions, so a
// plain constant can't live in this one

export type SimulateResult =
  | { ok: true; actionTaken: string; recordId: string }
  | { ok: false; error: string }
  | null;

// (previousState, formData) signature so this can be driven by
// useActionState
export async function simulateSanctionUpdate(
  _previousState: SimulateResult,
  formData: FormData,
): Promise<SimulateResult> {
  const recordId = formData.get("recordId");
  const actionTaken = formData.get("actionTaken");

  if (typeof recordId !== "string" || !DEMO_UPDATABLE_RECORDS.has(recordId)) {
    return { ok: false, error: "That record is not updatable in this demo." };
  }

  // the select in the UI already constrains this, but that's just UX -
  // this is the actual check
  if (typeof actionTaken !== "string" || !ALLOWED_ACTIONS_SET.has(actionTaken)) {
    return { ok: false, error: "That sanction is not one of the allowed demo values." };
  }

  // wrapped so a genuine failure here (a transient RDS hiccup) comes back
  // as a visible error instead of the request just throwing with nothing
  // shown - same reasoning as the try/catch in reviewAuditEntry below
  let auditId: number;
  try {
    const current = await getRecord(recordId);
    if (current === null) {
      return { ok: false, error: "Record not found." };
    }
    if (current.actionTaken === actionTaken) {
      return { ok: false, error: `${recordId} already has ${actionTaken} as its action taken.` };
    }

    // this is the proposal, not the write - pdd_records is untouched until
    // reviewAuditEntry approves it. written synchronously (not a workflow
    // step) so "Workflow run" has something to show the moment this
    // request returns, instead of racing the background dispatch below
    auditId = await recordAuditEntry(recordId, actionTaken);
  } catch {
    return { ok: false, error: "Something went wrong submitting this. Try again." };
  }

  // dispatched after the response is sent, not awaited - nothing here
  // blocks the person who just clicked Simulate. still durable: the
  // workflow runtime keeps this run paused until reviewAuditEntry resumes
  // it, even across a redeploy
  after(() => start(auditSanctionUpdateWorkflow, [auditId, recordId, actionTaken]));

  return { ok: true, actionTaken, recordId };
}

export type ReviewResult =
  | { ok: true; decision: "approve" | "reject"; recordId: string; message: string }
  | { ok: false; error: string }
  | null;

// resumes the paused workflow run for one audit entry - the hook token
// never reaches the client, this looks it up server-side by auditId so the
// form only ever has to send an id, a decision, and a comment
export async function reviewAuditEntry(
  _previousState: ReviewResult,
  formData: FormData,
): Promise<ReviewResult> {
  const auditId = Number(formData.get("auditId"));
  const decision = formData.get("decision");
  const comment = formData.get("comment");

  if (!Number.isInteger(auditId)) {
    return { ok: false, error: "Invalid entry." };
  }
  if (decision !== "approve" && decision !== "reject") {
    return { ok: false, error: "Choose approve or reject." };
  }

  const entry = await getAuditEntryForReview(auditId);
  if (entry === null) {
    return { ok: false, error: "This entry no longer exists." };
  }

  const approved = decision === "approve";
  const finalComment = typeof comment === "string" ? comment : "";

  // fallback for when there's no run left to resume - either this predates
  // the sign-off feature, the local dev workflow backend lost the run
  // across a restart, or resumeHook itself threw. the decision is still
  // real either way, so it's applied directly instead of leaving the entry
  // permanently stuck as unreviewable
  const finalizeDirectly = async () => {
    if (approved) {
      await applySanctionUpdate(entry.recordId, { actionTaken: entry.actionTaken });
    }
    await finalizeAuditEntry(auditId, approved, finalComment);
  };

  // wrapped so a genuine failure here (a transient RDS hiccup, the
  // workflow backend being unreachable) comes back as a visible error
  // instead of the request just throwing - the entry stays exactly as
  // pending as it was, so retrying is just clicking Approve/Reject again,
  // rather than it silently going nowhere and looking like a leftover
  try {
    if (entry.hookToken === null) {
      await finalizeDirectly();
    } else {
      try {
        // resumeHook only confirms the signal was delivered - awaiting
        // getRun(runId).returnValue is what actually waits for the resumed
        // run to finish its remaining steps (the write on an approval
        // included) before this request responds. reviewing is a
        // low-frequency admin action, not the public simulate button, so
        // waiting a moment here for a confirmed result is a fine tradeoff.
        //
        // raced against a timeout, not just awaited directly - if the run
        // is genuinely gone (not just erroring), returnValue can hang
        // rather than reject, and an unbounded await here would leave the
        // click looking like it did nothing instead of falling back
        const { runId } = await resumeHook(entry.hookToken, {
          approved,
          comment: finalComment,
        });
        await Promise.race([
          getRun(runId).returnValue,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timed out waiting for run")), 15_000),
          ),
        ]);
      } catch {
        await finalizeDirectly();
        // this run was live enough to accept resumeHook's signal but then
        // never actually finished - a strong sign the backend restarted
        // mid-flight, which means every other pending row is likely just
        // as orphaned, not only this one
        await clearOtherPendingEntries(auditId);
      }
    }
  } catch {
    return {
      ok: false,
      error: "Something went wrong writing this decision. Try again.",
    };
  }

  // an approval is what actually writes the record (see
  // workflows/sanction-update.ts) - a reject never touches it, so there's
  // nothing to invalidate
  if (approved) {
    updateTag(recordTag(entry.recordId));
  }

  // the pending list is a plain uncached read (lib/db.ts), so there's no
  // tag to invalidate for it - refresh() is enough to make the entry
  // disappear and, on an approval, show the newly written record
  refresh();

  return {
    ok: true,
    decision,
    recordId: entry.recordId,
    message: approved
      ? "Approval sent to the database."
      : "Database write rejected. Try again.",
  };
}

// called directly from the client (components/pending-reviews.tsx), not
// through a form - the database has no notion of "whose" a pending entry
// is, so this filters down to just the record ids the caller's own browser
// has simulated, tracked in memory there rather than in a cookie so a page
// reload genuinely forgets them instead of the list persisting forever.
//
// only ever the single most recent one, not a whole queue - simulating a
// second record before reviewing the first leaves the first one genuinely
// unreviewed in the database, it just isn't shown until you simulate that
// record again. deliberately simple over complete: a running audit list is
// closer to what a real system would show, but this is a demo of one
// change at a time, not a review queue
export async function getMyPendingEntries(recordIds: string[]): Promise<AuditEntry | null> {
  if (recordIds.length === 0) return null;

  const wanted = new Set(recordIds);
  const allPending = await getPendingAuditEntries();
  const matching = allPending.filter((entry) => wanted.has(entry.recordId));

  const result = matching.reduce<AuditEntry | null>(
    (latest, entry) => (latest === null || entry.id > latest.id ? entry : latest),
    null,
  );

  return result;
}
