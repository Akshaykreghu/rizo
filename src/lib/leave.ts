import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { toISODate } from './settlement';

// Shared helpers for Leave Management (LeaveRequestController port). Admin-only, same precedent as
// Regularisation/Resignation — no ESS/hierarchy-manager login exists in this app yet. Verified live
// against mypayrol_mpm121 before wiring: leave_transaction_prc, leave_auth_apr_person_fn,
// leave_balance_inthe_year_fn, leave_balance_inthe_month_fn all confirmed via SHOW CREATE.

export interface LeaveTypeOption {
  salaryHeadItemFkey: number;
  name: string;
  allowNegative: boolean;
  isLeaveEncash: boolean;
  documentMandatory: boolean;
  minLeave: number;
  maxLeave: number;
  minDayBeforeApply: number;
}

// Mirrors LeaveRequestController's leave-type dropdown: leave types applicable to this employee's
// leavepolicy group. `item` (not item_desc — corrected against the real schema) is the display name.
export async function getEmployeeLeaveTypes(pool: Pool, empFkey: number): Promise<LeaveTypeOption[]> {
  const [[proff]] = await pool.execute<RowDataPacket[]>(
    'SELECT LEAVEPOLICY_GROUP_ID FROM emp_proff WHERE emp_fkey = ?',
    [empFkey]
  );
  if (!proff?.LEAVEPOLICY_GROUP_ID) return [];

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT shi.salary_head_item_pkey, shi.item, lp.ALLOW_NEGETIVE, lp.is_leave_encash,
            lp.document_mandatory, lp.minimum_leave, lp.maximum_leave, lp.min_day_before_apply
     FROM leavepolicy lp
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = lp.salary_head_item_fkey
     WHERE lp.LEAVEPOLICY_GROUP_ID = ? AND lp.status = 1 AND shi.item_type = 'LEAVE' AND shi.status = 1`,
    [proff.LEAVEPOLICY_GROUP_ID]
  );

  return rows.map((r) => ({
    salaryHeadItemFkey: r.salary_head_item_pkey,
    name: (r.item ?? '').toString().trim(),
    allowNegative: r.ALLOW_NEGETIVE === 'Y',
    isLeaveEncash: r.is_leave_encash === 'Y',
    documentMandatory: r.document_mandatory === 'Y',
    minLeave: Number(r.minimum_leave ?? 0),
    maxLeave: Number(r.maximum_leave ?? 0),
    minDayBeforeApply: Number(r.min_day_before_apply ?? 0),
  }));
}

// Wraps leave_balance_inthe_year_fn / leave_balance_inthe_month_fn (confirmed live signatures),
// branching on the leave type's ALLOW_NEGETIVE flag exactly as legacy's criterias() does.
export async function getLeaveBalance(
  pool: Pool,
  empFkey: number,
  salaryHeadItemFkey: number,
  leaveDate: string,
  allowNegative: boolean
): Promise<number> {
  if (allowNegative) {
    const [[row]] = await pool.query<RowDataPacket[]>(
      'SELECT leave_balance_inthe_year_fn(?, ?, ?) AS bal',
      [empFkey, salaryHeadItemFkey, leaveDate]
    );
    return Number(row?.bal ?? 0);
  }
  const [[emp]] = await pool.execute<RowDataPacket[]>(
    'SELECT branch_code FROM emp_details WHERE emp_pkey = ?',
    [empFkey]
  );
  const [[finYear]] = await pool.execute<RowDataPacket[]>(
    `SELECT fin_year FROM fin_year
     WHERE branch_code = ? AND Year_status = 'OPEN' AND is_current_finyear = 'Y' AND status = 1
     ORDER BY start_month DESC LIMIT 1`,
    [emp?.branch_code ?? '']
  );
  const [[row]] = await pool.query<RowDataPacket[]>(
    'SELECT leave_balance_inthe_month_fn(?, ?, ?, ?) AS bal',
    [empFkey, salaryHeadItemFkey, leaveDate, String(finYear?.fin_year ?? '')]
  );
  return Number(row?.bal ?? 0);
}

// Wraps leave_auth_apr_person_fn (confirmed live: pcompany_code, plogin_emp_fkey, paction -> varchar
// emp_pkey, or a comma-list per legacy's convention — surfaced as-is, single value in observed data).
export async function getAuthorizerApprover(
  pool: Pool,
  companyCode: string,
  empFkey: number
): Promise<{ authorizerFkey: number | null; approverFkey: number | null }> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT leave_auth_apr_person_fn(?, ?, 'auth') AS auth_id, leave_auth_apr_person_fn(?, ?, 'apr') AS apr_id`,
    [companyCode, empFkey, companyCode, empFkey]
  );
  const authId = Number(row?.auth_id);
  const aprId = Number(row?.apr_id);
  return {
    authorizerFkey: Number.isFinite(authId) && authId > 0 ? authId : null,
    approverFkey: Number.isFinite(aprId) && aprId > 0 ? aprId : null,
  };
}

// Attendance-conflict guard ported from checkAttendancePunches()/the attendance-verified block in
// grandLeave(): blocks if real attendance (present punches) already exists for the date range, or if
// the employee's attendance is already verified (locked) for that month.
export async function checkAttendanceConflict(
  pool: Pool,
  empFkey: number,
  fromDate: string,
  toDate: string
): Promise<string | null> {
  const [[verified]] = await pool.execute<RowDataPacket[]>(
    `SELECT isdelete FROM attendance_register WHERE emp_fkey = ? AND month_year = ? LIMIT 1`,
    [empFkey, fromDate.slice(0, 7)]
  );
  if (verified?.isdelete === 'N') {
    return 'Attendance is already verified for this month — leave cannot be applied against a locked period';
  }

  const [[punched]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM emp_detail_timeattandance
     WHERE emp_pkey = ? AND att_date BETWEEN ? AND ? AND present LIKE 'P/%'`,
    [empFkey, fromDate, toDate]
  );
  if (Number(punched?.cnt ?? 0) > 0) {
    return 'Real attendance punches already exist for one or more of these dates';
  }
  return null;
}

// Runs leave_transaction_prc for the given leaveentries row and status (confirmed live signature:
// PLEAVEENTRYID, PEMP_fkey, PFROMDATE, PFROMHALF, PTODATE, PTOHALF, Pleave_days, Pleave_status, OUT).
// This is what actually writes emp_leave_transactions and recomputes balances — same "trust the
// stored proc" precedent as Attendance's insert_update_att_reg / Remove Employee's final_settle_pay_prc.
//
// IMPORTANT (found during curl-verification): the proc does NOT just record a transaction — it can
// silently overwrite leaveentries.LEAVESTATUS itself (e.g. to 'Can not Apply' when its own internal
// cycle/balance check fails, independent of the app-layer status we just wrote). Callers MUST re-read
// LEAVESTATUS after calling this, not assume the status they requested is what actually landed.
export async function runLeaveTransaction(
  conn: Pool | PoolConnection,
  entry: {
    leaveEntryId: number;
    empFkey: number;
    fromDate: string;
    fromHalf: number;
    toDate: string;
    toHalf: number;
    leaveDays: number;
    status: string;
  }
): Promise<{ finalStatus: string; errorMessage: string | null }> {
  await conn.query('CALL leave_transaction_prc(?, ?, ?, ?, ?, ?, ?, ?, @err)', [
    entry.leaveEntryId, entry.empFkey, entry.fromDate, entry.fromHalf,
    entry.toDate, entry.toHalf, entry.leaveDays, entry.status,
  ]);
  const [[errRow]] = await conn.query<RowDataPacket[]>('SELECT @err AS err');
  const [[statusRow]] = await conn.query<RowDataPacket[]>(
    'SELECT LEAVESTATUS FROM leaveentries WHERE LEAVEENTRYID = ?',
    [entry.leaveEntryId]
  );
  return { finalStatus: statusRow?.LEAVESTATUS ?? entry.status, errorMessage: errRow?.err ?? null };
}

export { toISODate };
