import type { Pool, RowDataPacket } from 'mysql2/promise';

// Shared helpers for Payroll Processing (PayrollController port, GRTL is not in legacy's
// $specialCompanies list so only the main calculate_salary_main_prc path is ported — the parallel
// salary_process_prc/tax_salary_process_prc path used by special tenants is out of scope). Verified
// live against mypayrol_mpm121 before wiring: payroll_master_insert, calculate_salary_main_prc,
// payroll_master_approve all confirmed via SHOW CREATE PROCEDURE. Note: payroll_master.month_year is
// 'YYYY-MM' but emp_variables_upload.month_year is 'MM-YYYY' — legacy reformats between the two
// (date_format(concat(month_year,'-01'),'%m-%Y')), replicated in monthYearToEvuFormat below.

export function monthYearToEvuFormat(monthYear: string): string {
  const [y, m] = monthYear.split('-');
  return `${m}-${y}`;
}

// Per-pool, per-column cache — schema doesn't change at runtime, so a SHOW COLUMNS check is safe
// to memoize for the life of the pool. Mirrors legacy's ad-hoc `$this->EmpSalarySlip->schema()` /
// `SHOW COLUMNS ... LIKE` checks scattered through PayrollController.
const columnExistsCache = new WeakMap<Pool, Map<string, boolean>>();

async function columnExists(pool: Pool, table: string, column: string): Promise<boolean> {
  let tableCache = columnExistsCache.get(pool);
  if (!tableCache) {
    tableCache = new Map();
    columnExistsCache.set(pool, tableCache);
  }
  const key = `${table}.${column}`;
  if (tableCache.has(key)) return tableCache.get(key)!;

  const [rows] = await pool.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  const exists = rows.length > 0;
  tableCache.set(key, exists);
  return exists;
}

// Safe arithmetic evaluator for `+ - * / ( )` expressions — replaces legacy's `eval("return $x;")`.
// Callers must pre-validate the charset (legacy's `/^[0-9+\-*/().\s]+$/` regex) before calling;
// this also re-validates internally and returns null on any malformed input rather than throwing.
function evalArithmetic(expr: string): number | null {
  const s = expr.replace(/\s+/g, '');
  if (!/^[0-9+\-*/().]+$/.test(s) || s.length === 0) return null;

  let pos = 0;
  const peek = () => s[pos];

  function parseExpr(): number {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = s[pos++];
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }
  function parseTerm(): number {
    let value = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = s[pos++];
      const rhs = parseFactor();
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  }
  function parseFactor(): number {
    if (peek() === '+') { pos++; return parseFactor(); }
    if (peek() === '-') { pos++; return -parseFactor(); }
    if (peek() === '(') {
      pos++;
      const value = parseExpr();
      if (peek() !== ')') throw new Error('mismatched parens');
      pos++;
      return value;
    }
    const start = pos;
    while (pos < s.length && /[0-9.]/.test(s[pos])) pos++;
    if (start === pos) throw new Error(`expected number at ${pos}`);
    return parseFloat(s.slice(start, pos));
  }

  try {
    const result = parseExpr();
    if (pos !== s.length || !Number.isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

// Mirrors the `emp_salary_slip` guard legacy uses across modules (EmployeeadvanceController::
// salarycheck(), EmployeeLoanController::amount_pay()/update_transfer()) to tell whether a live
// salary slip already exists for an employee in a given 'YYYY-MM' month. Advances treat a true
// result as advisory; loans treat it as a hard block — the caller decides.
export async function isPayrollAlreadyProcessed(pool: Pool, empFkey: number, monthYear: string): Promise<boolean> {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM emp_salary_slip WHERE month_year = ? AND emp_fkey = ? AND end_date_effective IS NULL`,
    [monthYear, empFkey]
  );
  return Number(row?.cnt ?? 0) > 0;
}

// Mirrors PayrollController::listpayroll()'s draft-seed path — calls payroll_master_insert, which
// itself deletes any pre-existing action IS NULL rows for the month/branch before reseeding from
// attendance_register (this is the real "reseed" mechanism, confirmed live).
export async function seedPayrollDraft(
  pool: Pool,
  branch: string,
  monthYear: string,
  userId: string
): Promise<string | null> {
  await pool.query('CALL payroll_master_insert(?, ?, ?, @err)', [branch, monthYear, userId]);
  const [[row]] = await pool.query<RowDataPacket[]>('SELECT @err AS err');
  return row?.err ?? null;
}

// Mirrors PayrollController::processpayroll()'s per-employee loop: calls calculate_salary_main_prc
// (sets payroll_master.action = 'Processed' itself, confirmed live inside the proc), then backfills
// the desig snapshot column exactly as legacy does via a separate designation lookup/update.
export async function processPayrollEmployee(
  pool: Pool,
  monthYear: string,
  branch: string,
  empPkey: number,
  payrollMasterPkey: number,
  userId: string
): Promise<string | null> {
  await pool.query('CALL calculate_salary_main_prc(?, ?, ?, ?, ?, @err)', [
    monthYear, branch, empPkey, payrollMasterPkey, userId,
  ]);
  const [[row]] = await pool.query<RowDataPacket[]>('SELECT @err AS err');

  const [[desigRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT d.desig_name FROM emp_proff p LEFT JOIN designation d ON d.desig_code = p.designation
     WHERE p.emp_fkey = ?`,
    [empPkey]
  );
  if (desigRow?.desig_name && await columnExists(pool, 'payroll_master', 'desig')) {
    await pool.execute('UPDATE payroll_master SET desig = ? WHERE payroll_master_pkey = ?', [
      desigRow.desig_name, payrollMasterPkey,
    ]);
  }

  return row?.err ?? null;
}

type FormulaSlipRow = RowDataPacket & {
  emp_salary_slip_pkey: number;
  remarks: string | null;
  salary_head_item_fkey: number;
  emp_fkey: number;
  month_year: string;
};

// Mirrors PayrollController::processpayroll()'s formula/remarks backfill (lines 1019-1193 in the
// legacy controller) — this sits OUTSIDE the $specialCompanies guard, so it runs for every
// tenant, not just the special-tenant list (unlike calculate_salary_main_prc's sibling
// salary_process_prc/tax_salary_process_prc path, which genuinely is special-tenant-only and
// stays out of scope). Recomputes remarks_2/formula/combined_base_value for each formula-driven
// emp_salary_slip row (structure_det_calequation-backed) after the main procedure has written the
// raw salary_amount values. remarks_2/combined_base_value are read by reporting downstream, so
// this is not write-only bookkeeping.
export async function backfillFormulaRemarks(pool: Pool, payrollMasterPkey: number): Promise<void> {
  if (!await columnExists(pool, 'emp_salary_slip', 'remarks_2')) return;

  const [rows] = await pool.execute<FormulaSlipRow[]>(
    `SELECT emp_salary_slip_pkey, remarks, salary_head_item_fkey, emp_fkey, month_year
     FROM emp_salary_slip
     WHERE payroll_master_fkey = ? AND remarks IS NOT NULL AND end_date_effective IS NULL
       AND head_type <> 'Arrear'`,
    [payrollMasterPkey]
  );

  for (const row of rows) {
    try {
      await backfillFormulaRemarksRow(pool, row);
    } catch (e) {
      console.error(`backfillFormulaRemarks: row ${row.emp_salary_slip_pkey} failed`, e);
    }
  }
}

const FORMULA_TOKEN_RE = /\d+_[A-Za-z_]+|monthsal/g;

async function backfillFormulaRemarksRow(pool: Pool, row: FormulaSlipRow): Promise<void> {
  const formulaFromRemarks = (row.remarks ?? '').replace(/\s+/g, '');
  if (!formulaFromRemarks) return;

  const [[structRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT structure_formula, structure_det_calequation, structure_det_depends, structure_det_operator
     FROM salary_structure_details
     WHERE salary_head_item_fkey = ?
       AND structure_id = (
         SELECT DISTINCT emp_structure_id FROM emp_salary_structure
         WHERE emp_fkey = ? AND end_date_effective IS NULL LIMIT 1
       )`,
    [row.salary_head_item_fkey, row.emp_fkey]
  );

  const formulaString: string = structRow?.structure_det_calequation ?? '';
  if (!formulaString) return;

  const structureFormula: string | null = structRow?.structure_formula ?? null;
  const limitType: string = structRow?.structure_det_operator ?? '';
  const limitVal: number = Number(structRow?.structure_det_depends ?? 0);

  // Single linear-scan replace over the original formula string (one .replace(re, fn) call),
  // not sequential per-token str_replace like legacy — avoids legacy's latent bug where a
  // just-substituted numeric value could accidentally match a still-unresolved token pattern.
  const tokens = Array.from(new Set(formulaString.match(FORMULA_TOKEN_RE) ?? []));
  const amounts = new Map<string, number>();

  for (const token of tokens) {
    if (token.toLowerCase() === 'monthsal') {
      const [[gross]] = await pool.execute<RowDataPacket[]>(
        `SELECT SUM(salary_amount) AS gross FROM emp_salary_slip
         WHERE emp_fkey = ? AND end_date_effective IS NULL AND month_year = ?
           AND head_operator = 'Addition' AND item_part = 'Direct'`,
        [row.emp_fkey, row.month_year]
      );
      amounts.set(token, Number(gross?.gross ?? 0));
    } else {
      const itemPkey = parseInt(token.split('_')[0], 10) || 0;
      let amount = 0;
      if (itemPkey) {
        const [[item]] = await pool.execute<RowDataPacket[]>(
          `SELECT salary_amount FROM emp_salary_slip
           WHERE emp_fkey = ? AND salary_head_item_fkey = ? AND month_year = ?
             AND end_date_effective IS NULL LIMIT 1`,
          [row.emp_fkey, itemPkey, row.month_year]
        );
        amount = Number(item?.salary_amount ?? 0);
      }
      amounts.set(token, amount);
    }
  }

  const replacedFormulaString = formulaString.replace(FORMULA_TOKEN_RE, (match) => String(amounts.get(match) ?? 0));

  const fields: string[] = ['remarks_2 = ?', 'formula = ?'];
  const values: (string | number | null)[] = [replacedFormulaString, structureFormula];

  if (replacedFormulaString) {
    const lastAsteriskPos = replacedFormulaString.lastIndexOf('*');
    let sumPart: string;
    let multiplierPart: string | undefined;
    if (lastAsteriskPos !== -1) {
      sumPart = replacedFormulaString.slice(0, lastAsteriskPos).trim();
      multiplierPart = replacedFormulaString.slice(lastAsteriskPos + 1).trim().replace(/\s+/g, '');
    } else {
      sumPart = replacedFormulaString.trim();
    }
    sumPart = sumPart.replace(/\s+/g, '');

    if (/^[0-9+\-().]+$/.test(sumPart)) {
      let combinedBaseValue = evalArithmetic(sumPart);
      if (combinedBaseValue !== null) {
        if (multiplierPart && /^[0-9+\-*/().\s]+$/.test(multiplierPart) &&
            (limitType === 'limit_wl' || limitType === 'limit_wg')) {
          const multiplierEval = evalArithmetic(multiplierPart);
          const multiplier = multiplierEval && multiplierEval !== 0 ? multiplierEval : 1;
          const effectiveLimit = limitVal / multiplier;
          combinedBaseValue = limitType === 'limit_wg'
            ? Math.max(combinedBaseValue, effectiveLimit)
            : Math.min(combinedBaseValue, effectiveLimit);
        }
        fields.push('combined_base_value = ?');
        values.push(combinedBaseValue);
      }
    }
  }

  values.push(row.emp_salary_slip_pkey);
  await pool.execute(
    `UPDATE emp_salary_slip SET ${fields.join(', ')} WHERE emp_salary_slip_pkey = ?`,
    values
  );
}

// Mirrors PayrollController::approvepayroll(): payroll_master_approve settles pending advances/loans
// tied to this payslip; the action='Approved' flip happens separately in the caller (matches legacy,
// where the proc itself does not set action).
export async function approvePayrollEmployee(
  pool: Pool,
  branch: string,
  monthYear: string,
  empFkey: number,
  userId: string
): Promise<string | null> {
  await pool.query('CALL payroll_master_approve(?, ?, ?, ?, @err)', [branch, monthYear, empFkey, userId]);
  const [[row]] = await pool.query<RowDataPacket[]>('SELECT @err AS err');
  return row?.err ?? null;
}
