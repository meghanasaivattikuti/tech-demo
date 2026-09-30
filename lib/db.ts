import sql from "mssql";
import { cacheLife, cacheTag } from "next/cache";

import { buildSearchPredicate, type SearchFilters } from "./pdd-search";

// Talks to RDS over TDS (mssql/tedious), not REST. The old Lambda
// pass-through didn't transform anything, so there's no reason to keep
// that hop around.

export type PDDRecord = {
  id: string;
  name: string;
  city: string;
  state: string;
  sportAffiliation: string;
  misconduct: string;
  actionTaken: string;
  additionalDetails: string | null;
  updatedAt: string;
};

type PDDRow = {
  id: string;
  name: string;
  city: string;
  state: string;
  sport_affiliation: string;
  misconduct: string;
  action_taken: string;
  additional_details: string | null;
  updated_at: Date;
};

// explicit columns, not SELECT * - don't want a schema change upstream
// silently leaking a new column onto the public page
const RECORD_COLUMNS = `
  id,
  name,
  city,
  state,
  sport_affiliation,
  misconduct,
  action_taken,
  additional_details,
  updated_at
`;

function toRecord(row: PDDRow): PDDRecord {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    state: row.state,
    sportAffiliation: row.sport_affiliation,
    misconduct: row.misconduct,
    actionTaken: row.action_taken,
    additionalDetails: row.additional_details,
    updatedAt: row.updated_at.toISOString(),
  };
}

// one pool per warm instance, cached on globalThis so we're not doing a
// fresh TCP+TLS handshake on every request
const POOL_SIZE = Number(process.env.DB_POOL_SIZE ?? 3);

declare global {
  var __dbPoolPromise: Promise<sql.ConnectionPool> | undefined;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Database connection details are supplied as encrypted Vercel environment variables; see .env.example.`,
    );
  }
  return value;
}

// tedious doesn't ship a bundled RDS CA the way mysql2 does, and Node's
// default trust store doesn't have the Amazon root either, so verification
// fails unless we hand it the cert ourselves. Not falling back to
// trustServerCertificate: true here since that just accepts anything.
//
// use the regional bundle, not the global one - global is 165KB across every
// region's roots, which blows past Vercel's 64KB env var limit
function tlsOptions() {
  const ca = process.env.DB_CA_CERT;

  if (!ca) {
    throw new Error(
      "Missing DB_CA_CERT. Set it to the contents of the regional Amazon RDS " +
        "CA bundle (https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem). " +
        "Refusing to connect without certificate verification.",
    );
  }

  return {
    encrypt: true,
    trustServerCertificate: false,
    cryptoCredentialsDetails: { ca },
  };
}

function pool(): Promise<sql.ConnectionPool> {
  if (!globalThis.__dbPoolPromise) {
    const config: sql.config = {
      server: requireEnv("DB_HOST"),
      port: Number(process.env.DB_PORT ?? 1433),
      user: requireEnv("DB_USER"),
      password: requireEnv("DB_PASSWORD"),
      database: requireEnv("DB_NAME"),
      connectionTimeout: 10_000,
      requestTimeout: 15_000,
      pool: { min: 0, max: POOL_SIZE, idleTimeoutMillis: 30_000 },
      options: tlsOptions(),
    };

    // cache the promise not the pool, so a failed connect doesn't leave a
    // broken pool cached forever, and concurrent cold requests share one
    // connect() instead of racing
    globalThis.__dbPoolPromise = new sql.ConnectionPool(config)
      .connect()
      .catch((error: unknown) => {
        globalThis.__dbPoolPromise = undefined;
        throw error;
      });
  }

  return globalThis.__dbPoolPromise;
}

// which records exist vs. what one record says are different questions -
// keeping them on separate tags means editing a sanction never touches the
// index
export const RECORD_INDEX_TAG = "pdd-record-index";

export function recordTag(id: string): string {
  return `record-${id}`;
}

// stale: 0 on purpose. every built in cacheLife profile defaults stale to
// 300s, which would let a client hold a 5 minute old copy of a safety
// record - exactly what this project is supposed to fix. revalidate/expire
// can be long because invalidation is event driven (updateTag on write), so
// they're just a backstop for a write we somehow missed
function safetyCriticalCacheLife() {
  cacheLife({ stale: 0, revalidate: 3600, expire: 86_400 });
}

// a cached function's body only runs on a miss, so this line is a direct
// signal that the data was re-read instead of served from cache. a warm
// render logs nothing, a cold one logs the index plus one per record, and a
// targeted invalidation logs exactly one. that makes the per-record claim
// observable in the runtime logs rather than something to take on trust.
// deliberately not called from getRecordUncached, which is a straight read
// and not a cache miss. same one-JSON-line-per-event shape as pdd.search
function logCacheMiss(tag: string, startedAt: number): void {
  console.log(
    JSON.stringify({
      event: "pdd.cache.miss",
      tag,
      durationMs: Date.now() - startedAt,
    }),
  );
}

export async function getRecordIndex(): Promise<string[]> {
  // remote, not plain "use cache". these reads sit behind connection(), so
  // they're deferred to request time, and the docs are explicit that in a
  // serverless environment each instance keeps its own in-memory cache and
  // hit rates there are lowest. measured on the deployment: with plain
  // "use cache" every request re-read all eleven entries, which is a 0% hit
  // rate and defeats the entire per-record design. remote gives one shared
  // cache across instances, at the cost of a lookup round trip
  "use cache: remote";
  cacheTag(RECORD_INDEX_TAG);
  safetyCriticalCacheLife();

  const startedAt = Date.now();
  const connection = await pool();
  const result = await connection
    .request()
    .query<Pick<PDDRow, "id">>("SELECT id FROM dbo.pdd_records ORDER BY name ASC");

  logCacheMiss(RECORD_INDEX_TAG, startedAt);

  return result.recordset.map((row) => row.id);
}

// cached per record, own tag - a write to PDD-1005 invalidates
// record-PDD-1005 only, the other nine stay cached
export async function getRecord(id: string): Promise<PDDRecord | null> {
  "use cache: remote";
  cacheTag(recordTag(id));
  safetyCriticalCacheLife();

  const startedAt = Date.now();
  const connection = await pool();
  const result = await connection
    .request()
    .input("id", sql.VarChar(32), id)
    .query<PDDRow>(`SELECT TOP (1) ${RECORD_COLUMNS} FROM dbo.pdd_records WHERE id = @id`);

  logCacheMiss(recordTag(id), startedAt);

  return result.recordset.length > 0 ? toRecord(result.recordset[0]) : null;
}

// not cached - search input is open ended so there's nothing worth reusing
// here. filters must already be past the safety check in pdd-search.ts,
// this doesn't re-check them
export async function searchRecords(filters: SearchFilters): Promise<PDDRecord[]> {
  const { sql: whereClause, params } = buildSearchPredicate(filters);

  const connection = await pool();
  const request = connection.request();

  // bind each parameter as the type its column is actually declared as.
  // state is CHAR(2) (db/schema.sql), and NVARCHAR outranks CHAR in T-SQL
  // datatype precedence, so binding NVarChar here would put the implicit
  // conversion on the *column* rather than the parameter. that defeats
  // IX_pdd_records_state, and under a SQL_ collation (which this schema
  // pins) SQL Server can't recover it with a range seek either. the
  // NVARCHAR columns are bound NVarChar for the same reason, in reverse.
  for (const param of params) {
    request.input(
      param.name,
      param.type === "char2" ? sql.Char(2) : sql.NVarChar(256),
      param.value,
    );
  }

  const result = await request.query<PDDRow>(
    `SELECT ${RECORD_COLUMNS} FROM dbo.pdd_records ${whereClause} ORDER BY name ASC`,
  );

  return result.recordset.map(toRecord);
}

export type SanctionUpdate = {
  actionTaken?: string;
  misconduct?: string;
  additionalDetails?: string | null;
};

// updated_at isn't set here on purpose, the AFTER UPDATE trigger in
// db/schema.sql handles it (T-SQL has no ON UPDATE CURRENT_TIMESTAMP like
// MySQL does). invalidation also isn't called here, the caller does that -
// updateTag needs to run inside the Server Action itself for the
// read-your-own-writes behavior to kick in
export async function applySanctionUpdate(
  id: string,
  update: SanctionUpdate,
): Promise<PDDRecord | null> {
  const connection = await pool();
  const request = connection.request().input("id", sql.VarChar(32), id);

  const assignments: string[] = [];

  if (update.actionTaken !== undefined) {
    assignments.push("action_taken = @actionTaken");
    request.input("actionTaken", sql.NVarChar(128), update.actionTaken);
  }
  if (update.misconduct !== undefined) {
    assignments.push("misconduct = @misconduct");
    request.input("misconduct", sql.NVarChar(128), update.misconduct);
  }
  if (update.additionalDetails !== undefined) {
    assignments.push("additional_details = @additionalDetails");
    request.input("additionalDetails", sql.NVarChar(sql.MAX), update.additionalDetails);
  }

  if (assignments.length === 0) {
    return getRecordUncached(id);
  }

  await request.query(
    `UPDATE dbo.pdd_records SET ${assignments.join(", ")} WHERE id = @id`,
  );

  return getRecordUncached(id);
}

export type AuditStatus = "pending" | "approved" | "rejected";

export type AuditEntry = {
  id: number;
  recordId: string;
  actionTaken: string;
  status: AuditStatus;
  changedAt: string;
};

// called synchronously from simulateSanctionUpdate (app/actions.ts), before
// the approval workflow even starts - this is the proposed change, not a
// record of one that already happened. OUTPUT INSERTED.id hands back the
// new row's id so the workflow can attach a hook token to this exact entry
export async function recordAuditEntry(
  recordId: string,
  actionTaken: string,
): Promise<number> {
  const connection = await pool();
  const result = await connection
    .request()
    .input("recordId", sql.VarChar(32), recordId)
    .input("actionTaken", sql.NVarChar(128), actionTaken)
    .query<{ id: number }>(
      `INSERT INTO dbo.pdd_record_audit (record_id, action_taken)
       OUTPUT INSERTED.id
       VALUES (@recordId, @actionTaken)`,
    );

  return result.recordset[0].id;
}

// the token is what reviewAuditEntry (app/actions.ts) needs to resume the
// paused workflow run - stored on the row it belongs to rather than in a
// separate table, since a demo doesn't need more than one hook per entry
export async function saveAuditHookToken(auditId: number, token: string): Promise<void> {
  const connection = await pool();
  await connection
    .request()
    .input("id", sql.Int, auditId)
    .input("token", sql.NVarChar(200), token)
    .query("UPDATE dbo.pdd_record_audit SET hook_token = @token WHERE id = @id");
}

// hookToken can legitimately be null even for a still-pending row - either
// it predates this feature, or the local dev workflow backend lost track
// of the run across a restart. either way reviewAuditEntry still has to be
// able to finalize the row directly, so the caller gets recordId and
// actionTaken either way rather than this collapsing to a single null
export async function getAuditEntryForReview(auditId: number): Promise<{
  recordId: string;
  actionTaken: string;
  hookToken: string | null;
} | null> {
  const connection = await pool();
  const result = await connection
    .request()
    .input("id", sql.Int, auditId)
    .query<{ record_id: string; action_taken: string; hook_token: string | null }>(
      "SELECT record_id, action_taken, hook_token FROM dbo.pdd_record_audit WHERE id = @id",
    );

  const row = result.recordset[0];
  if (row === undefined) return null;

  return {
    recordId: row.record_id,
    actionTaken: row.action_taken,
    hookToken: row.hook_token,
  };
}

// called from the workflow's last step, once the paused hook resolves with
// a supervisor's decision
export async function finalizeAuditEntry(
  auditId: number,
  approved: boolean,
  comment: string,
): Promise<void> {
  const connection = await pool();
  await connection
    .request()
    .input("id", sql.Int, auditId)
    .input("status", sql.NVarChar(20), approved ? "approved" : "rejected")
    .input("comment", sql.NVarChar(256), comment)
    .query(
      `UPDATE dbo.pdd_record_audit
       SET status = @status, reviewed_at = SYSUTCDATETIME(), reviewer_comment = @comment,
           hook_token = NULL
       WHERE id = @id`,
    );
}

// called when resuming a paused run times out (app/actions.ts) - a timeout
// there is a strong signal the whole local workflow backend lost track of
// its runs (typically a dev-server restart), not just this one entry's.
// every other still-pending row is equally likely orphaned, so this clears
// them out rather than letting them resurface one at a time as "the most
// recent pending entry" once each newer one gets resolved
export async function clearOtherPendingEntries(excludeAuditId: number): Promise<void> {
  const connection = await pool();
  await connection
    .request()
    .input("excludeId", sql.Int, excludeAuditId)
    .query("DELETE FROM dbo.pdd_record_audit WHERE status = 'pending' AND id <> @excludeId");
}

// not cached - this list changes on every review action, and it's a small,
// low-traffic panel, so there's nothing here worth a cache tag the way the
// main records are
export async function getPendingAuditEntries(): Promise<AuditEntry[]> {
  const connection = await pool();
  const result = await connection.request().query<{
    id: number;
    record_id: string;
    action_taken: string;
    status: string;
    changed_at: Date;
  }>(
    `SELECT id, record_id, action_taken, status, changed_at
     FROM dbo.pdd_record_audit
     WHERE status = 'pending'
     ORDER BY changed_at ASC`,
  );

  return result.recordset.map((row) => ({
    id: row.id,
    recordId: row.record_id,
    actionTaken: row.action_taken,
    status: row.status as AuditStatus,
    changedAt: row.changed_at.toISOString(),
  }));
}

// reads straight through, no cache - used right after a write so we see
// what actually landed instead of a copy we just invalidated
async function getRecordUncached(id: string): Promise<PDDRecord | null> {
  const connection = await pool();
  const result = await connection
    .request()
    .input("id", sql.VarChar(32), id)
    .query<PDDRow>(`SELECT TOP (1) ${RECORD_COLUMNS} FROM dbo.pdd_records WHERE id = @id`);

  return result.recordset.length > 0 ? toRecord(result.recordset[0]) : null;
}
