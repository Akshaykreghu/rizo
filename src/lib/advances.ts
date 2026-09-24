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

// Mirrors EmployeeadvanceController::salarycheck() — advisory warning only for advances, not a hard
// block (legacy's advance save doesn't actually call this before inserting). Now defined in
// lib/payroll.ts and shared with the Loans module; re-exported here so existing callers are unchanged.
export { isPayrollAlreadyProcessed } from './payroll';

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

// ── Advance Requests (employee "My Request" + admin approval) ──────────────────────────────────
// A new, separate table from `emp_advance`. Both the admin's pending-advances list above and the
// `payroll_master_approve` settlement proc scan `emp_advance` filtered only on
// `status = 1 AND is_credited = 'N'` — an unapproved employee request must never land there, or it
// would show up as a live advance and could be settled by payroll before anyone approves it. An
// `emp_advance` row is only created (via createAdvance() above) once a request is approved.

export interface AdvanceRequestInput {
  empFkey: number;
  advanceAmount: number;
  affectedMonth: string; // 'YYYY-MM'
  remarks?: string;
}

export async function createAdvanceRequest(pool: Pool, input: AdvanceRequestInput, userId: string): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO emp_advance_request
       (emp_fkey, advance_amount, affected_month, remarks, request_status, created_by, modified_by, modified_date, status)
     VALUES (?, ?, ?, ?, 'Pending', ?, ?, NOW(), 1)`,
    [input.empFkey, input.advanceAmount, input.affectedMonth, input.remarks ?? '', userId, userId]
  );
  return result.insertId;
}

export interface AdvanceRequestListParams {
  empFkey?: number;
  requestStatus?: 'Pending' | 'Approved' | 'Rejected';
  month?: string; // 'YYYY-MM'
}

export async function listAdvanceRequests(pool: Pool, params: AdvanceRequestListParams) {
  const conditions: string[] = ['ar.status = 1'];
  const args: (string | number)[] = [];
  if (params.empFkey) { conditions.push('ar.emp_fkey = ?'); args.push(params.empFkey); }
  if (params.requestStatus) { conditions.push('ar.request_status = ?'); args.push(params.requestStatus); }
  if (params.month) { conditions.push('ar.affected_month = ?'); args.push(params.month); }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ar.emp_advance_request_pkey, ar.emp_fkey, ar.advance_amount, ar.affected_month,
            ar.remarks, ar.request_status, ar.admin_remarks, ar.linked_advance_pkey,
            ar.reviewed_by, ar.reviewed_date, ar.created_date,
            CONCAT(COALESCE(ed.first_name,''),' ',COALESCE(ed.last_name,'')) AS emp_name
     FROM emp_advance_request ar
     JOIN emp_details ed ON ed.emp_pkey = ar.emp_fkey
     WHERE ${conditions.join(' AND ')}
     ORDER BY ar.created_date DESC`,
    args
  );
  return rows;
}

// Approving a request performs the exact same insert as the admin's direct "New Advance" flow
// (createAdvance), then marks the request Approved and links it to the new emp_advance row — run
// in a transaction so a request is never left half-approved.
export async function approveAdvanceRequest(pool: Pool, requestId: number, userId: string): Promise<{ advanceId: number }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[reqRow]] = await conn.execute<RowDataPacket[]>(
      'SELECT emp_advance_request_pkey, emp_fkey, advance_amount, affected_month, remarks, request_status FROM emp_advance_request WHERE emp_advance_request_pkey = ? AND status = 1 FOR UPDATE',
      [requestId]
    );
    if (!reqRow) throw new Error('NOT_FOUND');
    if (reqRow.request_status !== 'Pending') throw new Error('NOT_PENDING');

    const [advResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO emp_advance
         (emp_fkey, advance_amount, affected_month, is_credited, remarks, created_by, modified_by, modified_date, status, payment_date)
       VALUES (?, ?, ?, 'N', ?, ?, ?, NOW(), 1, NULL)`,
      [reqRow.emp_fkey, reqRow.advance_amount, reqRow.affected_month, reqRow.remarks ?? '', userId, userId]
    );
    const advanceId = advResult.insertId;

    await conn.execute(
      `UPDATE emp_advance_request
       SET request_status = 'Approved', linked_advance_pkey = ?, reviewed_by = ?, reviewed_date = NOW(), modified_by = ?, modified_date = NOW()
       WHERE emp_advance_request_pkey = ?`,
      [advanceId, userId, userId, requestId]
    );

    await conn.commit();
    return { advanceId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function rejectAdvanceRequest(pool: Pool, requestId: number, userId: string, adminRemarks?: string): Promise<void> {
  const [[reqRow]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_advance_request_pkey, request_status FROM emp_advance_request WHERE emp_advance_request_pkey = ? AND status = 1',
    [requestId]
  );
  if (!reqRow) throw new Error('NOT_FOUND');
  if (reqRow.request_status !== 'Pending') throw new Error('NOT_PENDING');

  await pool.execute(
    `UPDATE emp_advance_request
     SET request_status = 'Rejected', admin_remarks = ?, reviewed_by = ?, reviewed_date = NOW(), modified_by = ?, modified_date = NOW()
     WHERE emp_advance_request_pkey = ?`,
    [adminRemarks ?? null, userId, userId, requestId]
  );
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
