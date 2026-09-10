#!/usr/bin/env node
// One-off reconciliation for the Bulk Policy "Shift Allocation" tab migration
// (legacy/Bulk_Policy_Shift_Allocation_Migration_Plan.md §5).
//
// The OLD generic bulk-policies SHIFT tab wrote every assignment as
// emp_config(type='SHIFT', status=1) and blind-INSERTed, so a tenant that used it can have:
//   (a) multiple "primary" rows per employee   (type='SHIFT' status=1, >1 per emp_fkey)
//   (b) duplicate active rows for one shift     (same emp_fkey+policy_id, status IN (1,2), >1)
//
// This script reports those, and (with --apply) reconciles each affected employee to exactly
// one primary + zero duplicates, then re-syncs emp_proff.day_time_seq.
//
// Surviving primary = the row with the greatest emp_config.id among that employee's
// type='SHIFT' status=1 rows (the last one the old UI wrote == what emp_proff.day_time_seq
// currently holds, so the common single-assignment case is a no-op).
//
// Extra primaries are handled per --extra:
//   --extra=delete   (default) soft-delete them (status=0)      [plan §7 Q1 default]
//   --extra=demote            demote them to type='MSHIFT' status=2 (kept as secondary shifts)
//
// Usage:
//   node scripts/reconcile-shift-allocations.mjs [companyDbName]                 # dry run
//   node scripts/reconcile-shift-allocations.mjs [companyDbName] --apply
//   node scripts/reconcile-shift-allocations.mjs [companyDbName] --apply --extra=demote

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const extraMode = (args.find((a) => a.startsWith('--extra=')) || '--extra=delete').split('=')[1];
const companyDbName = args.find((a) => !a.startsWith('--')) || 'mypayrol_mpm121';
const RECON_USER = 'shift-reconcile-script';

if (!['delete', 'demote'].includes(extraMode)) {
  console.error(`Invalid --extra=${extraMode} (expected 'delete' or 'demote')`);
  process.exit(1);
}

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
  const pool = mysql.createPool({
    host: process.env.COMPANY_DB_HOST || 'localhost',
    user: process.env.COMPANY_DB_USER || process.env.CONTROL_DB_USER || 'root',
    password: process.env.COMPANY_DB_PASSWORD || process.env.CONTROL_DB_PASSWORD || '',
    database: companyDbName,
    multipleStatements: false,
  });

  console.log(`\n== Shift allocation reconciliation — DB '${companyDbName}' ==`);
  console.log(`   mode: ${apply ? 'APPLY' : 'DRY RUN'}   extra-primary handling: ${extraMode}\n`);

  // --- (a) employees with >1 primary shift row ------------------------------
  const [multiPrimary] = await pool.execute(
    `SELECT emp_fkey,
            COUNT(*)                        AS primary_count,
            GROUP_CONCAT(id ORDER BY id)    AS ids,
            MAX(id)                         AS keep_id
       FROM emp_config
      WHERE type = 'SHIFT' AND status = 1
      GROUP BY emp_fkey
     HAVING COUNT(*) > 1
      ORDER BY emp_fkey`
  );

  // --- (b) duplicate active rows for the same (emp_fkey, policy_id) --------
  const [dupRows] = await pool.execute(
    `SELECT emp_fkey, policy_id,
            COUNT(*)                     AS row_count,
            GROUP_CONCAT(id ORDER BY id) AS ids,
            MAX(id)                      AS keep_id
       FROM emp_config
      WHERE type IN ('SHIFT','MSHIFT') AND status IN (1,2)
      GROUP BY emp_fkey, policy_id
     HAVING COUNT(*) > 1
      ORDER BY emp_fkey, policy_id`
  );

  console.log(`(a) employees with multiple primary rows : ${multiPrimary.length}`);
  console.log(`(b) duplicate active (emp,shift) groups  : ${dupRows.length}\n`);

  if (!multiPrimary.length && !dupRows.length) {
    console.log('Nothing to reconcile. ✔');
    await pool.end();
    return;
  }

  for (const r of multiPrimary) {
    console.log(`  emp ${r.emp_fkey}: primary ids [${r.ids}] -> keep ${r.keep_id}, ` +
      `${extraMode === 'delete' ? 'soft-delete' : 'demote'} the rest`);
  }
  for (const r of dupRows) {
    console.log(`  emp ${r.emp_fkey} shift ${r.policy_id}: rows [${r.ids}] -> keep ${r.keep_id}, soft-delete the rest`);
  }

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to write these changes.');
    await pool.end();
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // (a) collapse extra primaries
    for (const r of multiPrimary) {
      const extraIds = r.ids.split(',').map(Number).filter((id) => id !== r.keep_id);
      if (!extraIds.length) continue;
      if (extraMode === 'delete') {
        await conn.query(
          `UPDATE emp_config SET status = 0, modified_by = ?, modification_date = NOW()
            WHERE id IN (?)`,
          [RECON_USER, extraIds]
        );
      } else {
        await conn.query(
          `UPDATE emp_config SET status = 2, type = 'MSHIFT', modified_by = ?, modification_date = NOW()
            WHERE id IN (?)`,
          [RECON_USER, extraIds]
        );
      }
    }

    // (b) collapse duplicate (emp,shift) groups — soft-delete all but the newest
    for (const r of dupRows) {
      const extraIds = r.ids.split(',').map(Number).filter((id) => id !== r.keep_id);
      if (!extraIds.length) continue;
      await conn.query(
        `UPDATE emp_config SET status = 0, modified_by = ?, modification_date = NOW()
          WHERE id IN (?)`,
        [RECON_USER, extraIds]
      );
    }

    // Re-sync emp_proff.day_time_seq for every employee we touched.
    const touched = [...new Set([
      ...multiPrimary.map((r) => r.emp_fkey),
      ...dupRows.map((r) => r.emp_fkey),
    ])];
    for (const empFkey of touched) {
      const [[primary]] = await conn.execute(
        `SELECT policy_id FROM emp_config
          WHERE emp_fkey = ? AND type = 'SHIFT' AND status = 1
          ORDER BY id DESC LIMIT 1`,
        [empFkey]
      );
      await conn.execute(
        `UPDATE emp_proff SET day_time_seq = ?, modified_by = ?, modified_date = NOW()
          WHERE emp_fkey = ?`,
        [primary ? primary.policy_id : 0, RECON_USER, empFkey]
      );
    }

    await conn.commit();
    console.log(`\nApplied. Re-synced emp_proff.day_time_seq for ${touched.length} employee(s).`);
  } catch (err) {
    await conn.rollback();
    console.error('\nRolled back — no changes written.');
    throw err;
  } finally {
    conn.release();
  }

  // Verify
  const [[mp]] = await pool.execute(
    `SELECT COUNT(*) c FROM (
       SELECT emp_fkey FROM emp_config WHERE type='SHIFT' AND status=1
       GROUP BY emp_fkey HAVING COUNT(*) > 1) x`
  );
  const [[dp]] = await pool.execute(
    `SELECT COUNT(*) c FROM (
       SELECT emp_fkey FROM emp_config WHERE type IN ('SHIFT','MSHIFT') AND status IN (1,2)
       GROUP BY emp_fkey, policy_id HAVING COUNT(*) > 1) x`
  );
  console.log(`Post-check: multi-primary=${mp.c}, duplicate-groups=${dp.c} (both should be 0).`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
