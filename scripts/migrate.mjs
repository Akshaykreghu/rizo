#!/usr/bin/env node
// Applies pending schema-change files from scripts/sql/ to every tenant database, tracked per DB
// in a small `schema_migrations` table so a given file is ever run at most once per DB — safe to
// call on every deploy. Same tenant-resolution pattern as create-image-templates.mjs (looks up
// every row in central_control, not just one company).
//
// Usage:
//   node scripts/migrate.mjs              # all tenant DBs
//   node scripts/migrate.mjs GRTL         # just one company's DB

import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

const [, , onlyCompanyCode] = process.argv;
const SQL_DIR = path.join(process.cwd(), 'scripts', 'sql');

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const CREATE_TRACKING_TABLE = `
CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
  \`filename\` varchar(255) NOT NULL,
  \`applied_date\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`filename\`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;`;

async function migrateOneDb(userDb, files) {
  const conn = await mysql.createConnection({
    host: process.env.COMPANY_DB_HOST || process.env.CONTROL_DB_HOST || 'localhost',
    user: process.env.CONTROL_DB_USER || 'root',
    password: process.env.CONTROL_DB_PASSWORD || '',
    database: userDb,
    multipleStatements: true, // a migration file may contain more than one statement
  });

  try {
    await conn.query(CREATE_TRACKING_TABLE);
    const [appliedRows] = await conn.execute('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedRows.map((r) => r.filename));

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log(`  ${userDb}: up to date (${files.length} migration(s) already applied).`);
      return;
    }

    for (const file of pending) {
      const sql = readFileSync(path.join(SQL_DIR, file), 'utf8');
      console.log(`  ${userDb}: applying ${file}...`);
      await conn.query(sql);
      await conn.execute('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
    }
    console.log(`  ${userDb}: applied ${pending.length} migration(s).`);
  } finally {
    await conn.end();
  }
}

async function main() {
  if (!existsSync(SQL_DIR)) {
    console.log('No scripts/sql directory found — nothing to migrate.');
    return;
  }
  const files = readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) {
    console.log('No .sql files in scripts/sql — nothing to migrate.');
    return;
  }

  const control = await mysql.createConnection({
    host: process.env.CONTROL_DB_HOST || 'localhost',
    user: process.env.CONTROL_DB_USER || 'root',
    password: process.env.CONTROL_DB_PASSWORD || '',
    database: process.env.CONTROL_DB_NAME || 'mypayrol_control_db',
  });

  const [tenants] = onlyCompanyCode
    ? await control.execute('SELECT company_code, user_db FROM central_control WHERE company_code = ?', [onlyCompanyCode])
    : await control.execute('SELECT company_code, user_db FROM central_control');
  await control.end();

  if (tenants.length === 0) {
    console.error(onlyCompanyCode ? `Company not found: ${onlyCompanyCode}` : 'No tenants found in central_control.');
    process.exit(1);
  }

  console.log(`Found ${files.length} migration file(s), ${tenants.length} tenant DB(s).`);
  for (const { company_code: companyCode, user_db: userDb } of tenants) {
    console.log(`\n${companyCode} (${userDb}):`);
    await migrateOneDb(userDb, files);
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
