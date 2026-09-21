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
// emp_pkey, OR a comma-joined list of eligible emp_pkeys — confirmed live, e.g. apr='67,2' for one
// employee — matching legacy's own `emp_pkey IN ($emp_ids)` convention in getusers()/addeditleave_new.
// A single scalar (Number(...)) silently breaks (NaN) whenever more than one candidate is eligible,
// so this returns every candidate id; callers pick one, same as legacy's searchable Approve By dropdown.
function parseEmpIdList(raw: unknown): number[] {
  if (raw == null) return [];
  return String(raw)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export async function getAuthorizerApprover(
  pool: Pool,
  companyCode: string,
  empFkey: number
): Promise<{ authorizerIds: number[]; approverIds: number[] }> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT leave_auth_apr_person_fn(?, ?, 'auth') AS auth_id, leave_auth_apr_person_fn(?, ?, 'apr') AS apr_id`,
    [companyCode, empFkey, companyCode, empFkey]
  );
  return {
    authorizerIds: parseEmpIdList(row?.auth_id),
    approverIds: parseEmpIdList(row?.apr_id),
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

// Ported from EmployeeLeaveUploadController::uploadandsaveempctc()'s bulk-path attendance check
// (controller.php:1566) — deliberately narrower than checkAttendanceConflict above: only the
// verified-register-for-start-month check, no real-punch check. Legacy's bulk path never checks
// emp_detail_timeattandance at all. Kept separate (not merged into checkAttendanceConflict) so the
// single-apply/manual-add paths keep their stricter check while bulk upload stays literal-parity.
export async function checkAttendanceRegisterVerified(
  pool: Pool,
  empFkey: number,
  fromDate: string
): Promise<string | null> {
  const [[verified]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM attendance_register
     WHERE month_year = DATE_FORMAT(?, '%Y-%m') AND isdelete = 'N' AND emp_fkey = ?`,
    [fromDate, empFkey]
  );
  if (Number(verified?.cnt ?? 0) > 0) {
    return 'Attendance Verified!';
  }
  return null;
}

function addMonthsISO(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

// Ported from the attendance-register verified-month check inside leavesave() (controller.php:
// 320-353) — used only by the manual single-add path. Unlike the bulk path's single-month check
// (checkAttendanceRegisterVerified above), this is boundary-aware: it checks whichever attendance
// period(s) the leave range actually touches, using att_start_end_fn anchored to fromDate's
// calendar month. Legacy's four branches overlap in places (its own redundancy, not invented here).
export async function checkAttendanceRegisterRangeVerified(
  pool: Pool,
  empFkey: number,
  fromDate: string,
  toDate: string
): Promise<string | null> {
  const monthStart = `${fromDate.slice(0, 7)}-01`;
  const [[startRow]] = await pool.query<RowDataPacket[]>(
    "SELECT att_start_end_fn(DATE_FORMAT(?, '%Y-%m-01'), 1) AS d",
    [monthStart]
  );
  const [[endRow]] = await pool.query<RowDataPacket[]>(
    "SELECT att_start_end_fn(DATE_FORMAT(?, '%Y-%m-01'), 2) AS d",
    [monthStart]
  );
  const attStart = toISODate(startRow.d as string | Date);
  const attEnd = toISODate(endRow.d as string | Date);

  const countVerified = async (monthYearDate: string) => {
    const [[row]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM attendance_register
       WHERE month_year = DATE_FORMAT(?, '%Y-%m') AND isdelete = 'N' AND emp_fkey = ?`,
      [monthYearDate, empFkey]
    );
    return Number(row?.cnt ?? 0);
  };

  let count = 0;
  if (fromDate >= attStart && toDate <= attEnd) {
    count = await countVerified(attEnd);
  } else if (fromDate <= attEnd && toDate >= attEnd) {
    count = (await countVerified(fromDate)) + (await countVerified(addMonthsISO(fromDate, 1)));
  } else if (fromDate >= attEnd && toDate >= attEnd) {
    count = await countVerified(addMonthsISO(attEnd, 1));
  } else if (fromDate <= attEnd && toDate <= attEnd) {
    count = await countVerified(attEnd);
  }

  return count > 0 ? 'Leave Can not be saved, Attendance Verified for this Month' : null;
}

// Ported from checkAttendancePunches() (controller.php:2515) — used by the manual single-add path
// (leavesave()). Returns a bitmask: 1 = first-half punch conflict, 2 = second-half, 3 = both/full-day.
// Distinct from checkAttendanceConflict's simple "any punch in range" check because legacy's manual
// path is half-day-aware (it lets you apply for the half of a day that has no punch).
export async function checkAttendancePunches(
  pool: Pool,
  empFkey: number,
  fromDate: string,
  toDate: string,
  fromHalf: number,
  toHalf: number
): Promise<number> {
  const [records] = await pool.execute<RowDataPacket[]>(
    `SELECT att_date, present FROM emp_detail_timeattandance
     WHERE emp_pkey = ? AND att_date BETWEEN ? AND ?
       AND (present LIKE 'P/%' OR present LIKE '%/P' OR present = 'P'
            OR present LIKE 'p/%' OR present LIKE '%/p' OR present = 'p')`,
    [empFkey, fromDate, toDate]
  );
  if (!records.length) return 0;

  let conflictMask = 0;
  for (const rec of records) {
    const attDate = toISODate(rec.att_date as string | Date);
    const present = String(rec.present ?? '').trim();

    let firstHalfPresent = false;
    let secondHalfPresent = false;
    if (present.includes('/')) {
      const [a, b] = present.split('/');
      if (a?.trim().toUpperCase() === 'P') firstHalfPresent = true;
      if (b?.trim().toUpperCase() === 'P') secondHalfPresent = true;
    } else if (present.toUpperCase() === 'P') {
      firstHalfPresent = true;
      secondHalfPresent = true;
    }
    if (!firstHalfPresent && !secondHalfPresent) continue;

    let checkFirstHalf = true;
    let checkSecondHalf = true;
    if (attDate === fromDate && fromHalf === 2) checkFirstHalf = false;
    if (attDate === toDate && toHalf === 1) checkSecondHalf = false;

    if (checkFirstHalf && firstHalfPresent) conflictMask |= 1;
    if (checkSecondHalf && secondHalfPresent) conflictMask |= 2;
  }
  return conflictMask;
}

const RESTRICTED_BALANCE_COMPANIES = [
  'KWMT', 'ABSG', 'MBCT', 'MRBS', 'STCL', 'AGNG', 'ESNP', 'VGNN', 'AYRK', 'VGFS', 'VSFS',
];

// Ported from getLeaveBalanceForAuthOrApproval() (controller.php:2062) — live only for the 11
// tenants above; monthly_balance is hardcoded to 0 for everyone else (matches legacy exactly,
// this is a real branch in legacy's own source, not dead code being invented here). leave_days is
// always 0 in legacy too (the caller reads a key the function never returns), so the gate reduces
// to `monthlyBalance < 0`.
export async function getMonthlyLeaveBalanceForUpload(
  pool: Pool,
  companyCode: string,
  empFkey: number,
  salaryHeadItemFkey: number,
  toDate: string
): Promise<number> {
  if (!RESTRICTED_BALANCE_COMPANIES.includes(companyCode)) {
    return 0;
  }
  const [[emp]] = await pool.execute<RowDataPacket[]>(
    'SELECT branch_code FROM emp_details WHERE emp_pkey = ?',
    [empFkey]
  );
  const [[finYear]] = await pool.execute<RowDataPacket[]>(
    `SELECT fin_year FROM fin_year
     WHERE LOWER(Year_status) = 'open' AND vattr1 = 0 AND is_current_finyear = 'Y' AND status = 1
       AND branch_code = ?
     ORDER BY fin_year DESC LIMIT 1`,
    [emp?.branch_code ?? '']
  );
  const finYearValue = finYear?.fin_year ?? new Date().getFullYear();
  // leave_balance_inthe_month_fn's Pmonth param is a DATE (it runs DATE_FORMAT/LAST_DAY on it
  // internally — confirmed via SHOW CREATE FUNCTION); legacy passes just the month digits
  // (date('m', ...)), a type mismatch that only survives legacy's lenient sql_mode. Passing the
  // full date here instead — matching how getLeaveBalance above already calls the same function —
  // is a type-correctness fix, not a parity deviation: legacy's literal value would error under a
  // strict connection rather than produce a different balance.
  const [[row]] = await pool.query<RowDataPacket[]>(
    'SELECT leave_balance_inthe_month_fn(?, ?, ?, ?) AS bal',
    [empFkey, salaryHeadItemFkey, toDate, String(finYearValue)]
  );
  return Number(row?.bal ?? 0);
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

// Ported from `Leave_balance_upload_fn()` (confirmed live via SHOW CREATE FUNCTION on
// mypayrol_mpm121) for the new Leave Balance Upload feature (EmpleaveuploadController — a
// different, unrouted-in-legacy controller from EmployeeLeaveUploadController's leave *request*
// upload above). The stored function processes the ENTIRE staging table with no parameters;
// this port takes companyCode purely as documentation of the calling convention (only called for
// RESTRICTED_BALANCE_COMPANIES) — it still processes every unprocessed (status=1) row in the
// caller's own company pool, matching the function's own signature/scope, not just one employee.
export async function applyLeaveBalanceUpload(pool: Pool, companyCode: string): Promise<void> {
  void companyCode;
  const [pending] = await pool.query<RowDataPacket[]>(
    `SELECT leave_balance_upload_pky, empid, leave_type, leave_balance
     FROM leave_balance_upload WHERE status = 1 ORDER BY empid DESC`
  );

  for (const row of pending) {
    const uploadPky = row.leave_balance_upload_pky as number;
    const salaryHeadItemFkey = Number(row.leave_type);
    const uploadedBalance = Number(row.leave_balance);

    const [[emp]] = await pool.execute<RowDataPacket[]>(
      `SELECT ed.emp_pkey, ed.branch_code
       FROM emp_proff ep JOIN emp_details ed ON ed.emp_pkey = ep.emp_fkey
       WHERE ep.emp_company_id = ?`,
      [row.empid]
    );
    if (!emp?.emp_pkey) {
      await pool.execute('UPDATE leave_balance_upload SET status = 0 WHERE leave_balance_upload_pky = ?', [uploadPky]);
      continue;
    }
    const empFkey = Number(emp.emp_pkey);

    const [[shi]] = await pool.execute<RowDataPacket[]>(
      'SELECT leave_cycle_start_month FROM salary_head_items WHERE salary_head_item_pkey = ?',
      [salaryHeadItemFkey]
    );
    const cycleStartMonth = Number(shi?.leave_cycle_start_month ?? 0);

    let finYear: string;
    let cycleStart: string;
    let cycleEnd: string;
    const currentYear = new Date().getFullYear();
    if (cycleStartMonth > 0) {
      // Cycle runs pfinyear-vstart_from-01 to (pfinyear+1)-vstart_from-01 minus 1 day, per the
      // live function body — pfinyear here is simply the current calendar year.
      const startMonthStr = String(cycleStartMonth).padStart(2, '0');
      cycleStart = `${currentYear}-${startMonthStr}-01`;
      const endYear = currentYear + 1;
      const nextCycleStart = new Date(`${endYear}-${startMonthStr}-01T00:00:00Z`);
      nextCycleStart.setUTCDate(nextCycleStart.getUTCDate() - 1);
      cycleEnd = nextCycleStart.toISOString().slice(0, 10);
      finYear = String(currentYear);
    } else {
      const [[fy]] = await pool.execute<RowDataPacket[]>(
        `SELECT fin_year, start_month, end_month FROM fin_year
         WHERE CURDATE() BETWEEN start_month AND end_month AND vattr1 = 0 AND is_current_finyear = 'Y'
           AND branch_code = ?`,
        [emp.branch_code]
      );
      if (!fy) {
        await pool.execute('UPDATE leave_balance_upload SET status = 0 WHERE leave_balance_upload_pky = ?', [uploadPky]);
        continue;
      }
      finYear = String(fy.fin_year);
      cycleStart = toISODate(fy.start_month as string | Date) ?? '';
      cycleEnd = toISODate(fy.end_month as string | Date) ?? '';
    }

    const [[policy]] = await pool.execute<RowDataPacket[]>(
      `SELECT lp.LEAVEPOLICYID FROM leavepolicy lp
       JOIN emp_proff ep ON ep.LEAVEPOLICY_GROUP_ID = lp.LEAVEPOLICY_GROUP_ID
       WHERE ep.emp_fkey = ? AND lp.salary_head_item_fkey = ? AND lp.status = 1`,
      [empFkey, salaryHeadItemFkey]
    );
    if (!policy) {
      await pool.execute('UPDATE leave_balance_upload SET status = 0 WHERE leave_balance_upload_pky = ?', [uploadPky]);
      continue;
    }

    const [[yearlyRow]] = await pool.query<RowDataPacket[]>(
      'SELECT leave_balance_inthe_year_fn(?, ?, ?) AS bal',
      [empFkey, salaryHeadItemFkey, finYear]
    );
    const yearlyBalance = Number(yearlyRow?.bal ?? 0);
    const carryForwarded = uploadedBalance - yearlyBalance;

    const [[existing]] = await pool.execute<RowDataPacket[]>(
      `SELECT emp_leave_balance_year_pkey FROM emp_leave_balance_year
       WHERE emp_fkey = ? AND salary_head_item_fkey = ? AND fin_year = ? AND status = 1`,
      [empFkey, salaryHeadItemFkey, finYear]
    );

    if (existing) {
      await pool.execute(
        'UPDATE emp_leave_balance_year SET status = 0 WHERE emp_leave_balance_year_pkey = ?',
        [existing.emp_leave_balance_year_pkey]
      );
    }
    await pool.execute(
      `INSERT INTO emp_leave_balance_year
         (emp_fkey, salary_head_item_fkey, leave_cycle_start_date, leave_cycle_end_date, fin_year,
          carry_forwarded, data_source, status, creation_date, created_time)
       VALUES (?, ?, ?, ?, ?, ?, 'upload', 1, NOW(), NOW())`,
      [empFkey, salaryHeadItemFkey, cycleStart, cycleEnd, finYear, carryForwarded]
    );

    await pool.execute('UPDATE leave_balance_upload SET status = 0 WHERE leave_balance_upload_pky = ?', [uploadPky]);
  }
}

export { RESTRICTED_BALANCE_COMPANIES, toISODate };
