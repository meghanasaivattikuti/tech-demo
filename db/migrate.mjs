#!/usr/bin/env node
// applies schema.sql + seed.sql. RDS for SQL Server has no "initial
// database name" option at creation like RDS for MySQL does, so this
// connects to master and creates the database first, then runs both files.
//
// usage: node db/migrate.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sql from "mssql";

const here = dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(join(here, "..", ".env.local"));
} catch {
  // fine if it's missing, vars might already be exported
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`\nMissing ${name}. Copy .env.example to .env.local and fill it in.\n`);
    process.exit(1);
  }
  return value;
}

const HOST = requireEnv("DB_HOST");
const PORT = Number(process.env.DB_PORT ?? 1433);
const USER = requireEnv("DB_USER");
const PASSWORD = requireEnv("DB_PASSWORD");
const DATABASE = requireEnv("DB_NAME");

const CA = process.env.DB_CA_CERT;
if (!CA) {
  console.error(
    "\nMissing DB_CA_CERT.\n" +
      "Download it with:\n" +
      "  curl -o db/rds-ca-bundle.pem \\\n" +
      "    https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem\n" +
      "  (regional, 4.6KB. The global bundle is 165KB and exceeds Vercel's 64KB env var cap.)\n" +
      "then set DB_CA_CERT in .env.local to its contents.\n",
  );
  process.exit(1);
}

function config(database) {
  return {
    server: HOST,
    port: PORT,
    user: USER,
    password: PASSWORD,
    database,
    connectionTimeout: 20_000,
    requestTimeout: 60_000,
    pool: { min: 0, max: 1 },
    options: {
      encrypt: true,
      trustServerCertificate: false,
      cryptoCredentialsDetails: { ca: CA },
    },
  };
}

// GO is a sqlcmd/SSMS batch separator, not real T-SQL, so it has to be
// split out before sending. required here since CREATE OR ALTER TRIGGER
// needs to be alone in its batch
function splitBatches(script) {
  return script
    .split(/^\s*GO\s*$/gim)
    .map((batch) => batch.trim())
    .filter((batch) => batch.length > 0);
}

async function run(label, pool, script) {
  const batches = splitBatches(script);
  process.stdout.write(`${label}: ${batches.length} batch(es)... `);

  for (const [index, batch] of batches.entries()) {
    try {
      await pool.request().batch(batch);
    } catch (error) {
      console.error(`\n\n${label} failed on batch ${index + 1}:\n`);
      console.error(batch.slice(0, 400));
      console.error(`\n${error.message}\n`);
      throw error;
    }
  }

  console.log("ok");
}

async function main() {
  console.log(`\nDatabase migration -> ${HOST}:${PORT}, database "${DATABASE}"\n`);

  // CREATE DATABASE has to be the only statement in its batch and won't
  // take a variable for the name, so this builds the statement with
  // QUOTENAME and runs it through sp_executesql instead of EXEC(), which
  // rejects function calls like QUOTENAME inline
  const masterPool = await new sql.ConnectionPool(config("master")).connect();
  try {
    process.stdout.write(`ensuring database "${DATABASE}" exists... `);
    await masterPool
      .request()
      .input("name", sql.NVarChar(128), DATABASE)
      .batch(
        `IF DB_ID(@name) IS NULL
         BEGIN
           DECLARE @stmt NVARCHAR(300) = N'CREATE DATABASE ' + QUOTENAME(@name);
           EXEC sp_executesql @stmt;
         END`,
      );
    console.log("ok");
  } finally {
    await masterPool.close();
  }

  const pool = await new sql.ConnectionPool(config(DATABASE)).connect();
  try {
    await run("schema", pool, readFileSync(join(here, "schema.sql"), "utf8"));
    await run("seed", pool, readFileSync(join(here, "seed.sql"), "utf8"));

    const { recordset } = await pool
      .request()
      .query("SELECT COUNT(*) AS total FROM dbo.pdd_records");
    console.log(`\ndone. pdd_records now holds ${recordset[0].total} rows.\n`);
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
