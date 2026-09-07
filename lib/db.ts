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

export async function getRecordIndex(): Promise<string[]> {
  "use cache";
  cacheTag(RECORD_INDEX_TAG);
  safetyCriticalCacheLife();

  const connection = await pool();
  const result = await connection
    .request()
    .query<Pick<PDDRow, "id">>("SELECT id FROM dbo.pdd_records ORDER BY name ASC");

  return result.recordset.map((row) => row.id);
}

// cached per record, own tag - a write to PDD-1005 invalidates
// record-PDD-1005 only, the other nine stay cached
export async function getRecord(id: string): Promise<PDDRecord | null> {
  "use cache";
  cacheTag(recordTag(id));
  safetyCriticalCacheLife();

  const connection = await pool();
  const result = await connection
    .request()
    .input("id", sql.VarChar(32), id)
    .query<PDDRow>(`SELECT TOP (1) ${RECORD_COLUMNS} FROM dbo.pdd_records WHERE id = @id`);

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
