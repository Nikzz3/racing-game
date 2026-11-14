#!/usr/bin/env node
// Tiny Postgres client for verify.sh (no psql on the host is assumed).
//   pg.mjs admin <admin-url> "<statement>"   run against the admin database
//   pg.mjs query "<query>"                   run against $VERIFY_DB_URL, print rows as JSON
import { createRequire } from "node:module";

const require = createRequire(`${process.env.VERIFY_REPO ?? process.cwd()}/e2e/package.json`);
const { Client } = require("pg");

const [mode, ...rest] = process.argv.slice(2);
const [url, sql] = mode === "admin" ? rest : [process.env.VERIFY_DB_URL, rest[0]];
if (!url || !sql) {
  console.error("usage: pg.mjs admin <url> <sql> | pg.mjs query <sql>");
  process.exit(2);
}
// `query` is for reading side effects; a read-only transaction makes seeding impossible.
const client = new Client({
  connectionString: url,
  ...(mode === "query" && { options: "-c default_transaction_read_only=on" }),
});
try {
  await client.connect();
  const result = await client.query(sql);
  if (mode === "query") console.log(JSON.stringify(result.rows, null, 2));
} catch (error) {
  console.error(`pg: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
