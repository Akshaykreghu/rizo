#!/usr/bin/env node
// One-off admin utility for SAL-012 — audits every Formula/Limit/Limit-With-Bound salary
// structure component and syncs the stale, display-only `structure_formula` column (legacy
// plain-English text, e.g. "Monthly Gross Salary * . 40") back to whatever the real,
// authoritative `structure_det_calequation` token string says (e.g. "monthsal * . 40"), for
// any row where the calequation is itself syntactically valid but the two have drifted apart.
//
// Also reports (but does NOT attempt to guess-fix) any row whose structure_det_calequation
// itself is genuinely unparseable — these need a human to re-enter the formula through the
// app's Formula Builder, since there's no reliable way to recover a real expression from
// leftover placeholder text (e.g. literal "formula").
//
// Usage:
//   node scripts/audit-salary-formulas.mjs [companyDbName]        # dry run, report only
//   node scripts/audit-salary-formulas.mjs [companyDbName] --apply  # write the sync fixes

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const companyDbName = args.find((a) => !a.startsWith('--')) || 'mypayrol_mpm121';

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

// Purely syntactic check — same token grammar as src/lib/salaryFormula.ts's
// resolveToNumericExpression, but without requiring real item values, since this is a
// structural audit ("is this even the right kind of string"), not a numeric evaluation.
const IDENTIFIER_RE = /^\d+_/;
function isSyntacticallyValid(formula) {
  const tokens = formula.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every(
    (t) => t === 'monthsal' || IDENTIFIER_RE.test(t) || /^[0-9+\-*/.()]+$/.test(t)
  );
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.COMPANY_DB_HOST || 'localhost',
    user: process.env.COMPANY_DB_USER || process.env.CONTROL_DB_USER || 'root',
    password: process.env.COMPANY_DB_PASSWORD || process.env.CONTROL_DB_PASSWORD || '',
    database: companyDbName,
  });

  const [rows] = await pool.execute(
    `SELECT ssd.structure_det_id, ssd.structure_id, ssd.salary_head_item_fkey, shi.item,
            ssd.structure_det_operator, ssd.structure_det_calequation, ssd.structure_formula
     FROM salary_structure_details ssd
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = ssd.salary_head_item_fkey
     WHERE ssd.structure_det_operator IN ('formula','limit','limit_wl','limit_wg')
       AND ssd.structure_det_calequation IS NOT NULL AND ssd.structure_det_calequation <> ''`
  );

  let synced = 0;
  let alreadyOk = 0;
  const broken = [];

  for (const row of rows) {
    const calequation = row.structure_det_calequation;
    const valid = isSyntacticallyValid(calequation);

    if (!valid) {
      broken.push(row);
      continue;
    }

    if (row.structure_formula !== calequation) {
      console.log(
        `[structure ${row.structure_id}] "${row.item.trim()}": syncing structure_formula\n` +
          `    from: ${JSON.stringify(row.structure_formula)}\n` +
          `    to:   ${JSON.stringify(calequation)}`
      );
      if (apply) {
        await pool.execute('UPDATE salary_structure_details SET structure_formula = ? WHERE structure_det_id = ?', [
          calequation,
          row.structure_det_id,
        ]);
      }
      synced++;
    } else {
      alreadyOk++;
    }
  }

  console.log(`\n${alreadyOk} row(s) already consistent, ${synced} row(s) ${apply ? 'synced' : 'would be synced (dry run — pass --apply to write)'}.`);

  if (broken.length) {
    console.log(`\n${broken.length} row(s) have a genuinely unparseable structure_det_calequation — these need a human to re-enter the formula via the app's Formula Builder, not an automated fix:`);
    for (const row of broken) {
      console.log(`  - structure ${row.structure_id}, "${row.item.trim()}" (${row.structure_det_operator}): ${JSON.stringify(row.structure_det_calequation)}`);
    }
  } else {
    console.log('\nNo unparseable formulas found.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
