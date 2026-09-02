#!/usr/bin/env node
// One-off admin utility: creates the `templates` / `templates_details` tables the legacy
// image-certificate designer (DocumentManagerController::template()/save_template()/
// sendemailtemplate()) uses, for tenants that don't already have them.
//
// These two tables are NOT part of the schema dumps in this repo, so tenants migrated from
// legacy may already have them (with data) while fresh tenants have neither. This script uses
// CREATE TABLE IF NOT EXISTS, so it never touches an existing table — run it once per tenant DB
// before using the "Image Templates" tab of Generate Employee Documents.
//
// Usage:
//   node scripts/create-image-templates.mjs [companyCode]
//
// Resolves the tenant DB the same way the app does (central_control lookup by company_code).

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

const [, , companyCode = 'GRTL'] = process.argv;

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

const CREATE_TEMPLATES = `
CREATE TABLE IF NOT EXISTS \`templates\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`name\` varchar(200) DEFAULT NULL,
  \`type\` varchar(50) DEFAULT NULL,
  \`image\` varchar(500) DEFAULT NULL,
  \`imageLeft\` float DEFAULT 0,
  \`imageTop\` float DEFAULT 0,
  \`imagesize\` float DEFAULT 0,
  \`imageHeight\` float DEFAULT 0,
  \`is_default\` tinyint(1) NOT NULL DEFAULT 0,
  \`status\` tinyint(1) NOT NULL DEFAULT 1,
  \`created_by\` varchar(50) DEFAULT NULL,
  \`creation_date\` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;`;

const CREATE_TEMPLATES_DETAILS = `
CREATE TABLE IF NOT EXISTS \`templates_details\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT,
  \`templateid\` int(11) NOT NULL,
  \`text_content\` text DEFAULT NULL,
  \`left_axis\` float DEFAULT 0,
  \`top_axis\` float DEFAULT 0,
  \`creation_date\` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`templateid\` (\`templateid\`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;`;

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
    multipleStatements: false,
  });

  for (const table of ['templates', 'templates_details']) {
    const [existing] = await conn.execute(
      'SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
      [userDb, table]
    );
    if (existing[0].c > 0) {
      console.log(`${table}: already exists in ${userDb} — left untouched.`);
    }
  }

  await conn.query(CREATE_TEMPLATES);
  await conn.query(CREATE_TEMPLATES_DETAILS);
  console.log(`Done. templates / templates_details ensured in ${userDb} (${companyCode}).`);
  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
