import { Suspense } from "react";
import { connection } from "next/server";

import { getRecord, getRecordIndex } from "@/lib/db";
import {
  RecordRow,
  RecordRowSkeleton,
  RecordsTable,
  RecordsTableEmpty,
} from "@/components/records-table";
import { SearchPanel } from "@/components/search-panel";
import { SimulateUpdate } from "@/components/simulate-update";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      {/* everything above the table is data-free so it's part of the static shell */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Public Disciplinary Database
        </h1>
        <p className="text-sm text-muted-foreground">
          Public record of individuals sanctioned through a national sports-safety
          disciplinary process. All data shown is fictional.
        </p>
      </div>

      <SearchPanel />

      <Suspense fallback={null}>
        <SimulateUpdate />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle>All records</CardTitle>
          {/* no "last refreshed at" timestamp here, each record has its own
              cache lifetime so there's no single moment to point at */}
        </CardHeader>
        <CardContent>
          <Suspense fallback={<PendingTable />}>
            <PublishedRecords />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}

// connection() holds this until a real request comes in, otherwise next
// build would try to run these cached reads and hit RDS during the build,
// which can't reach the database since the build container isn't on the
// Secure Compute network
async function PublishedRecords() {
  await connection();

  const ids = await getRecordIndex();

  if (ids.length === 0) {
    return (
      <RecordsTable>
        <RecordsTableEmpty message="No published records." />
      </RecordsTable>
    );
  }

  return (
    <RecordsTable>
      {ids.map((id) => (
        // one Suspense boundary per row so invalidating one tag only
        // re-reads that row, the rest keep serving from cache
        <Suspense key={id} fallback={<RecordRowSkeleton />}>
          <PublishedRecord id={id} />
        </Suspense>
      ))}
    </RecordsTable>
  );
}

async function PublishedRecord({ id }: { id: string }) {
  const record = await getRecord(id);
  if (!record) return null;

  return <RecordRow record={record} />;
}

function PendingTable() {
  return (
    <RecordsTable>
      {Array.from({ length: 5 }).map((_, index) => (
        <RecordRowSkeleton key={index} />
      ))}
    </RecordsTable>
  );
}
