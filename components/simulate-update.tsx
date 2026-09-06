import { connection } from "next/server";

import { getRecord, getRecordIndex } from "@/lib/db";
import { SimulateUpdatePicker } from "@/components/simulate-update-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
    <Card>
      <CardHeader>
        <CardTitle>Simulate a change in the system of record</CardTitle>
        <p className="text-sm text-muted-foreground">
          Pick any record below, write a new sanction directly to RDS, then invalidate
          one cache tag. Everything else keeps serving from cache.
        </p>
      </CardHeader>
      <CardContent>
        <SimulateUpdatePicker records={records} />
      </CardContent>
    </Card>
  );
}
