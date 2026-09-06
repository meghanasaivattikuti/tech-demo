"use server";

import { refresh, updateTag } from "next/cache";

import { applySanctionUpdate, getRecord, recordTag } from "@/lib/db";
import { ALLOWED_ACTIONS_SET } from "@/lib/sanctions";

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

// ALLOWED_ACTIONS/suggestNextAction live in lib/sanctions.ts instead of
// here - a "use server" file can only export async server actions, so a
// plain constant can't live in this one

export type SimulateResult =
  | { ok: true; actionTaken: string }
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

  const current = await getRecord(recordId);
  if (current === null) {
    return { ok: false, error: "Record not found." };
  }

  const updated = await applySanctionUpdate(recordId, { actionTaken });
  if (updated === null) {
    return { ok: false, error: "Update did not apply." };
  }

  // one tag, not the page, not the index, not the other nine records -
  // updateTag over revalidateTag since it gives read-your-own-writes
  // inside a Server Action, so this render can't show a stale value back
  // to the person who just wrote it
  updateTag(recordTag(recordId));

  // updateTag clears the server cache entry but not whatever the client
  // router already rendered, refresh() handles that half
  refresh();

  return { ok: true, actionTaken: updated.actionTaken };
}
