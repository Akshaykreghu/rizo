import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { evaluateArithmetic, FormulaError } from '@/lib/salaryFormula';

// Shared port of the "move an employee onto a salary structure" flow — the inline block in
// EmployeeConfigController::addEmpToSallary() and the structure branch of
// SalaryIncrementController::alterSalaryStructure(). Used by:
//   - /api/employees/bulk-policies/salary   (Bulk Policy Allocation, SALARY tab)
//   - src/lib/increments.ts alterSalaryStructure()  (Salary Increment, structure-change)
//
// emp_proff.structure_id is maintained entirely by the live DB triggers emp_config_bi
// (INSERT -> set) / emp_config_au (UPDATE -> null), verified present on mypayrol_mpm121, so
// this helper never writes that column directly — it INSERTs the emp_config SALARY audit row
// and lets the trigger do it.

// Companies whose CTC upload type is NOT reset on structure allocation
// (EmployeeConfigController::addEmpToSallary). GRTL is not in this list.
export const SPECIAL_COMPANIES = new Set([
  'ABSG', 'VGFS', 'VSFS', 'DRRC', 'DJIC', 'AGNG', 'AYRK', 'GTRA', 'VGNN', 'SHYD', 'SRTS',
]);

// ESI head descriptions get ceil (deduction) / round (otherwise) instead of plain round,
// matching addEmpToSallary's / alterSalaryStructure's inline remark-recompute block.
export const ESI_DESCS = new Set([
  'esi',
  'esi - employee contribution',
  'esi - employer contribution',
]);

export interface AllocateStructureInput {
  companyCode: string;
  userId: string;
  empFkey: number;
  structureId: number;
}

export interface AllocateStructureResult {
  /** sal_structure_distribution_fn returned 1 (at least one structure row was created). */
  ok: boolean;
  /** Non-fatal per-head remark-formula issues (row skipped, not aborted) — matches legacy. */
  formulaWarnings: string[];
}

// Port of EmployeeConfigController::addEmpToSallary for a single employee, minus the HTTP
// envelope. Must run inside a caller-managed transaction (`conn` from pool.getConnection()).
export async function allocateSalaryStructure(
  conn: PoolConnection,
  { companyCode, userId, empFkey, structureId }: AllocateStructureInput,
): Promise<AllocateStructureResult> {
  // 1. Reset a pending CTC upload (non-special companies only).
  if (!SPECIAL_COMPANIES.has(companyCode.toUpperCase())) {
    await conn.execute(
      `UPDATE emp_ctc_transaction SET ctc_upload_type = 1
       WHERE emp_fkey = ? AND ctc_upload_type = 2 AND end_date_effective IS NULL`,
      [empFkey],
    );
  }

  // 2. Run the distribution engine (end-dates old rows, inserts new ones, writes remark
  //    formulas, sets emp_derived_anualctc + ctc_upload_type=1). Returns 1 if rows were created.
  const [[fn]] = await conn.execute<RowDataPacket[]>(
    'SELECT sal_structure_distribution_fn(?, ?, ?, ?) AS result',
    [companyCode, empFkey, structureId, userId],
  );
  const ok = Number(fn?.result) === 1;

  // 3. Recompute formula heads from their (now fully numeric) `remarks` string — follows the
  //    inline block in legacy exactly, including the ESI ceil/round split and the Deduction
  //    sign flip. Legacy runs this regardless of the fn result.
  const formulaWarnings: string[] = [];
  const [remarkRows] = await conn.execute<RowDataPacket[]>(
    `SELECT emp_salary_structure_pkey, head_operator, remarks, salary_head_item_desc
     FROM emp_salary_structure
     WHERE emp_structure_id = ? AND emp_fkey = ? AND remarks IS NOT NULL AND end_date_effective IS NULL`,
    [structureId, empFkey],
  );
  for (const row of remarkRows) {
    const formula = String(row.remarks ?? '').replace(/\s+/g, '');
    if (!formula) continue;
    let amount: number;
    try {
      amount = evaluateArithmetic(formula);
    } catch (e) {
      if (e instanceof FormulaError) {
        formulaWarnings.push(`Skipped remark formula on head "${row.salary_head_item_desc}": ${e.message}`);
        continue;
      }
      throw e;
    }
    const isEsi = ESI_DESCS.has(String(row.salary_head_item_desc ?? '').trim().toLowerCase());
    const isDeduction = row.head_operator === 'Deduction';
    amount = isEsi && isDeduction ? Math.ceil(amount) : Math.round(amount);
    if (isDeduction) amount = -amount;
    await conn.execute(
      'UPDATE emp_salary_structure SET structure_det_value = ? WHERE emp_salary_structure_pkey = ?',
      [amount, row.emp_salary_structure_pkey],
    );
  }

  // 4. Audit row — the emp_config_bi trigger sets emp_proff.structure_id from this INSERT.
  //    Only on a successful distribution (matches legacy `if ($result == 1)`).
  if (ok) {
    const [[emp]] = await conn.execute<RowDataPacket[]>(
      'SELECT branch_code FROM emp_details WHERE emp_pkey = ?',
      [empFkey],
    );
    await conn.execute(
      `INSERT INTO emp_config (type, company_code, branch_code, emp_fkey, policy_id, created_by, status)
       VALUES ('SALARY', ?, ?, ?, ?, ?, 1)`,
      [companyCode, emp?.branch_code ?? null, empFkey, structureId, userId],
    );

    // 5. Post-distribution limit adjustment (errors swallowed, matching legacy's try/catch).
    try {
      await conn.execute('CALL salary_structure_limit_prc(?, ?, @perr_msg)', [empFkey, userId]);
    } catch {
      /* legacy wraps this in try/catch and ignores failures */
    }
  }

  return { ok, formulaWarnings };
}
