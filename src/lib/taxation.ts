import type { Pool, RowDataPacket } from 'mysql2/promise';

// Shared helpers for the Taxation module (TaxController.php port). The declaration/lock/upload
// workflow already exists (tax-declarations routes) — this covers the actual computation engine:
// wiring the live tax_salary_distribution_fn/tax_salary_distribution_new_fn SQL functions (both
// regimes' slab math, HRA exemption, surcharge/cess/rebate/marginal-relief, and the monthly-TDS
// redistribution formula are all implemented live in these functions — confirmed via SHOW CREATE
// FUNCTION — so this file orchestrates, it does not reimplement tax law) and regime selection
// (Choosetax). No default regime row exists for most employees live (emp_tax_regime has 1 row
// total in this dev DB); by explicit product decision this port defaults an unset employee to
// 'N' (New regime), matching one of legacy's two inconsistent code paths (the other defaults 'O').

export interface OpenFinYear {
  finYearSeq: number;
  finYear: number;
  startMonth: string;
  endMonth: string;
}

// Mirrors the fin_year resolution already used by tax-declarations: branch-scoped, the real
// Apr-Mar tax year (vattr1=1), currently open. Reused here rather than duplicated per-route.
export async function getOpenFinYear(pool: Pool, branchCode: string): Promise<OpenFinYear | null> {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT Fin_year_seq, fin_year, start_month, end_month
     FROM fin_year
     WHERE branch_code = ? AND Year_status = 'OPEN' AND is_current_finyear = 'Y' AND status = 1
     ORDER BY start_month DESC LIMIT 1`,
    [branchCode]
  );
  if (!row) return null;
  return { finYearSeq: row.Fin_year_seq, finYear: row.fin_year, startMonth: row.start_month, endMonth: row.end_month };
}

// Wraps the live tax_salary_distribution_fn (old regime) / tax_salary_distribution_new_fn (new
// regime) SQL functions — both are called unconditionally, matching TaxController::setup()/
// Proccess(), which always computes both for the side-by-side comparison UI regardless of which
// regime the employee has chosen.
export async function runTaxDistribution(
  pool: Pool, companyCode: string, empFkey: number, finYear: number, userId: string
): Promise<{ oldResult: number; newResult: number }> {
  const [[oldRow]] = await pool.query<RowDataPacket[]>(
    'SELECT tax_salary_distribution_fn(?, ?, ?, ?) AS result',
    [companyCode, empFkey, String(finYear), userId]
  );
  const [[newRow]] = await pool.query<RowDataPacket[]>(
    'SELECT tax_salary_distribution_new_fn(?, ?, ?, ?) AS result',
    [companyCode, empFkey, String(finYear), userId]
  );
  return { oldResult: Number(oldRow?.result ?? 0), newResult: Number(newRow?.result ?? 0) };
}

// Reads back the currently-open (end_date_effective IS NULL) summary row from each regime's
// summary table — rebuilt fresh every time runTaxDistribution() runs.
export async function getTaxSummary(pool: Pool, empFkey: number, finYear: number) {
  const [[oldSummary]] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM emp_tax_sal_trans_sum
     WHERE emp_fkey = ? AND fin_year = ? AND status = 1 AND end_date_effective IS NULL
     ORDER BY emp_tax_sal_trans_sum_pkey DESC LIMIT 1`,
    [empFkey, String(finYear)]
  );
  const [[newSummary]] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM emp_tax_sal_trans_sum_new
     WHERE emp_fkey = ? AND fin_year = ? AND status = 1 AND end_date_effective IS NULL
     ORDER BY emp_tax_sal_trans_sum_new_pkey DESC LIMIT 1`,
    [empFkey, String(finYear)]
  );
  return { old: oldSummary ?? null, new: newSummary ?? null };
}

// Mirrors TaxController::Choosetax(): end-dates any prior open regime row for the employee, then
// inserts the new choice. Legacy end-dates by emp_fkey alone (not scoped to fin_year) — replicated
// exactly, since a regime choice is effectively an employee-level setting that gets re-asserted
// per fin_year rather than one row staying open per year.
export async function chooseTaxRegime(
  pool: Pool, empFkey: number, finYear: number, optionType: 'O' | 'N', userId: string
): Promise<void> {
  const [[openCount]] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS cnt FROM emp_tax_regime WHERE emp_fkey = ? AND end_date_effective IS NULL',
    [empFkey]
  );
  if (Number(openCount?.cnt ?? 0) > 0) {
    await pool.execute(
      'UPDATE emp_tax_regime SET end_date_effective = CURDATE(), modified_by = ? WHERE emp_fkey = ? AND end_date_effective IS NULL',
      [userId, empFkey]
    );
  }
  await pool.execute(
    'INSERT INTO emp_tax_regime (emp_fkey, fin_year, option_type, created_by) VALUES (?, ?, ?, ?)',
    [empFkey, finYear, optionType, userId]
  );
}

// The employee's current regime choice, defaulting to 'N' (New) when none exists yet — see the
// module comment above for why 'N' rather than legacy's other, inconsistent 'O' default.
export async function getCurrentRegime(pool: Pool, empFkey: number): Promise<'O' | 'N'> {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    'SELECT option_type FROM emp_tax_regime WHERE emp_fkey = ? AND end_date_effective IS NULL ORDER BY emp_tax_regime_id DESC LIMIT 1',
    [empFkey]
  );
  return row?.option_type === 'O' ? 'O' : 'N';
}
