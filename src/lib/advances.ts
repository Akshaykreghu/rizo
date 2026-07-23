import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

// Shared helpers for Salary Advances (EmployeeadvanceController.php port — NOT the unrelated
// AdvanceController.php/advance_expense petty-cash feature, confirmed a different module during
// research). A single lump-sum row, no repayment schedule — repayment is consumed wholesale by
// `payroll_master_approve` (already wired). Creation == approval in legacy, no workflow.
// GRTL is not in the GLET/ABSG special-tenant list, so only the simple 80%-of-monthly-gross limit
// formula applies here (legacy's per-attendance-prorated variant for those two tenants is out of
// scope for this port).

// Mirrors EmployeeadvanceController::salary() (GRTL/simple-tenant branch): 80% of one month's
// gross (annual CTC / 12), advisory only — legacy does not hard-block a save that exceeds this.
export async function getAdvanceLimit(pool: Pool, empFkey: number): Promise<number> {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_anual_ctc FROM emp_ctc_transaction WHERE emp_fkey = ? AND end_date_effective IS NULL`,
    [empFkey]
  );
  const annualCtc = Number(row?.emp_anual_ctc ?? 0);
  const monthlyGross = Math.round(annualCtc / 12);
  return Math.round(0.8 * monthlyGross);
}

// Mirrors EmployeeadvanceController::salarycheck() — advisory warning only, not a hard block
// (legacy's save doesn't actually call this before inserting).
export async function isPayrollAlreadyProcessed(pool: Pool, empFkey: number, monthYear: string): Promise<boolean> {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM emp_salary_slip WHERE month_year = ? AND emp_fkey = ? AND end_date_effective IS NULL`,
    [monthYear, empFkey]
  );
  return Number(row?.cnt ?? 0) > 0;
}

export interface AdvanceInput {
  empFkey: number;
  advanceAmount: number;
  affectedMonth: string; // 'YYYY-MM'
  remarks?: string;
  paymentDate?: string;
}

// Mirrors EmployeeadvanceController::employeeloansave() (advance-save handler, despite the name).
export async function createAdvance(pool: Pool, input: AdvanceInput, userId: string): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO emp_advance
       (emp_fkey, advance_amount, affected_month, is_credited, remarks, created_by, modified_by,
        modified_date, status, payment_date)
     VALUES (?, ?, ?, 'N', ?, ?, ?, NOW(), 1, ?)`,
    [input.empFkey, input.advanceAmount, input.affectedMonth, input.remarks ?? '', userId, userId, input.paymentDate ?? null]
  );
  return result.insertId;
}

export interface AdvanceListParams {
  empFkey?: number;
  branchCode?: string;
  month?: string; // 'YYYY-MM', defaults to current month
}

// Mirrors EmployeeadvanceController::employeelist() — only shows is_credited='N' rows (a pending
// queue), defaulting to the current month, matching legacy's real behavior.
export async function listAdvances(pool: Pool, params: AdvanceListParams) {
  const month = params.month ?? new Date().toISOString().slice(0, 7);
  const conditions: string[] = ['au.status = 1', "au.is_credited = 'N'", '(au.affected_month = ? OR au.affected_month = ?)'];
  const args: (string | number)[] = [`${month}-01`, month];
  if (params.empFkey) { conditions.push('au.emp_fkey = ?'); args.push(params.empFkey); }
  if (params.branchCode) { conditions.push('ed.branch_code = ?'); args.push(params.branchCode); }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT au.emp_advance_pkey, au.emp_fkey, au.advance_amount, au.affected_month, au.is_credited,
            au.remarks, au.payment_date, au.created_date,
            CONCAT(COALESCE(ed.first_name,''),' ',COALESCE(ed.last_name,'')) AS emp_name
     FROM emp_details ed
     JOIN emp_advance au ON ed.emp_pkey = au.emp_fkey
     WHERE ${conditions.join(' AND ')}
     ORDER BY au.created_date DESC`,
    args
  );
  return rows;
}
