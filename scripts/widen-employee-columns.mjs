#!/usr/bin/env node
// One-off schema fix for employee "Other Details" columns that are narrower than what the forms
// allow. With STRICT_TRANS_TABLES on (as on these DBs) a too-long value fails the save outright.
//   - document_type varchar(20) -> 50 on emp_documents (Join wizard) and emp_passport_visa
//     (Employee Details): the picker offers "Educational Certificate" (23 chars).
//   - family contact_number / alternate_number varchar(10) -> 15 on family (Join wizard) and
//     emp_family (Employee Details / ESS): the forms accept 10–15 digit numbers.
// Keeps each column's own character set / collation / NOT NULL, and skips a column that is already
// wide enough, so it is safe to run more than once — run it once per tenant DB.
//
// Usage:
//   node scripts/widen-employee-columns.mjs [companyCode]
//
// Resolves the tenant DB the same way the app does (central_control lookup by company_code).

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

const [, , companyCode = 'GRTL'] = process.argv;
const TARGETS = [
  { table: 'emp_documents', column: 'document_type', length: 50 },
  { table: 'emp_passport_visa', column: 'document_type', length: 50 },
  { table: 'family', column: 'contact_number', length: 15 },
  { table: 'family', column: 'alternate_number', length: 15 },
  { table: 'emp_family', column: 'contact_number', length: 15 },
  { table: 'emp_family', column: 'alternate_number', length: 15 },
];

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

async function main() {
  const control = await mysql.createConnection({
    host: process.env.CONTROL_DB_HOST || 'localhost',
    user: process.env.CONTROL_DB_USER || 'root',
    password: process.env.CONTROL_DB_PASSWORD || '',
    database: process.env.CONTROL_DB_NAME || 'mypayrol_control_db',
  });
  const [rows] = await control.execute(
    "SELECT user_db FROM central_control WHERE company_code = ? AND active = 'active'",
    [companyCode]
  );
  await control.end();
  if (!rows.length) {
    console.error(`Company not found or inactive: ${companyCode}`);
    process.exit(1);
  }
  const userDb = rows[0].user_db;

  const conn = await mysql.createConnection({
    host: process.env.COMPANY_DB_HOST || process.env.CONTROL_DB_HOST || 'localhost',
    user: process.env.CONTROL_DB_USER || 'root',
    password: process.env.CONTROL_DB_PASSWORD || '',
    database: userDb,
  });

  for (const { table, column, length } of TARGETS) {
    const [[col]] = await conn.execute(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS len, CHARACTER_SET_NAME AS cs, COLLATION_NAME AS co, IS_NULLABLE AS nullable
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [userDb, table, column]
    );
    if (!col) {
      console.log(`${table}.${column}: not found in ${userDb} — skipped.`);
      continue;
    }
    if (Number(col.len) >= length) {
      console.log(`${table}.${column}: already varchar(${col.len}) in ${userDb} — left untouched.`);
      continue;
    }
    await conn.query(
      `ALTER TABLE \`${table}\` MODIFY \`${column}\` varchar(${length})
         CHARACTER SET ${col.cs} COLLATE ${col.co} ${col.nullable === 'NO' ? 'NOT NULL' : 'NULL'}`
    );
    console.log(`${table}.${column}: widened varchar(${col.len}) -> varchar(${length}) in ${userDb}.`);
  }
  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
