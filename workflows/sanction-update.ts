import { createHook } from "workflow";

import { applySanctionUpdate, finalizeAuditEntry, saveAuditHookToken } from "@/lib/db";

async function saveHookToken(auditId: number, token: string): Promise<void> {
  "use step";
  await saveAuditHookToken(auditId, token);
}

// the actual write to pdd_records - only ever runs if the decision is
// approved. a reject never touches the record at all, so there's nothing
// to undo: the write simply never happened
async function writeRecord(recordId: string, actionTaken: string): Promise<void> {
  "use step";
  await applySanctionUpdate(recordId, { actionTaken });
}

async function finalizeEntry(
  auditId: number,
  approved: boolean,
  comment: string,
): Promise<void> {
  "use step";
  await finalizeAuditEntry(auditId, approved, comment);
}

// the pending audit row (auditId) is already written synchronously in
// simulateSanctionUpdate (app/actions.ts) before this run even starts -
// that's what lets "Workflow run" show the entry immediately without
// waiting on this dispatch. this run exists entirely to hold the pause:
// it sits suspended until reviewAuditEntry resumes it with a decision, and
// only then does the record actually get written
export async function auditSanctionUpdateWorkflow(
  auditId: number,
  recordId: string,
  actionTaken: string,
): Promise<void> {
  "use workflow";

  using hook = createHook<{ approved: boolean; comment: string }>();
  await saveHookToken(auditId, hook.token);

  const decision = await hook;

  if (decision.approved) {
    await writeRecord(recordId, actionTaken);
  }

  await finalizeEntry(auditId, decision.approved, decision.comment);
}
