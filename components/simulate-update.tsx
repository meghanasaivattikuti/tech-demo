import { connection } from "next/server";

import { getRecord, getRecordIndex } from "@/lib/db";
import { CollapsibleCard } from "@/components/collapsible-card";
import { SimulateUpdatePicker } from "@/components/simulate-update-picker";

// fetches all ten records through the same cached getRecord() the table
// uses, so this is free once the table's already rendered, then hands them
// to a client picker so any one of them can be the demo target
export async function SimulateUpdate() {
  await connection();

  const ids = await getRecordIndex();
  const records = (await Promise.all(ids.map((id) => getRecord(id)))).filter(
    (record) => record !== null,
  );

  if (records.length === 0) return null;

  return (
    <CollapsibleCard
      title="Simulate a change in the system of record"
      description="Pick any record below and propose a new sanction. Nothing is written to RDS until it's approved in Workflow run."
      defaultOpen={false}
    >
      <SimulateUpdatePicker records={records} />
    </CollapsibleCard>
  );
}
