import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { toISODate } from './settlement';

export { toISODate };

// Mirrors legacy AttendanceRegisterNew's cell color palette (registerbook.ctp/verifiedregisterbook.ctp
// applyCellColor() JS, duplicated 3x in legacy — centralized here instead). `isPolicyLeave` distinguishes
// a leave-policy-backed LOP (approved leave that happens to render as LOP) from a genuine unexplained LOP.
export function getCellColor(rawValue: string, isPolicyLeave: boolean): { bg: string; fg: string } {
  const value = (rawValue ?? '').trim().toUpperCase();
  if (!value) return { bg: '#ebebeb', fg: '#000' };

  const parts = value.split('/');
  const isFullLop = value === 'LOP' || value === 'LOP/LOP';
  const containsLop = parts.some((p) => p.includes('LOP'));

  if (value === 'WO' || value === 'WO/WO') return { bg: '#dcdc00', fg: '#fff' };
  if (value === 'HO' || value === 'HO/HO') return { bg: '#2d2df4', fg: '#fff' };
  if (value === 'P' || value === 'P/P' || parts.every((p) => p === 'P' || p === 'A')) {
    return { bg: '#06a226', fg: '#fff' };
  }
  if (containsLop) {
    if (isPolicyLeave) return { bg: '#ebebeb', fg: '#000' };
    return isFullLop ? { bg: '#e02429', fg: '#fff' } : { bg: '#ef8656', fg: '#fff' };
  }
  if (value === 'NA') return { bg: '#f0f0f0', fg: '#666' };
  return { bg: '#ebebeb', fg: '#000' };
}

export const ATTENDANCE_LEGEND = [
  { code: 'P', label: 'Present', bg: '#06a226', fg: '#fff' },
  { code: 'HO', label: 'Holiday', bg: '#2d2df4', fg: '#fff' },
  { code: 'WO', label: 'Week Off', bg: '#dcdc00', fg: '#fff' },
  { code: 'LOP', label: 'Absent', bg: '#e02429', fg: '#fff' },
];

export interface AttPeriod {
  start: string;
  end: string;
}

// Wraps att_start_end_fn (confirmed live: RETURNS date, reads db_config.attendance_format/attendance_date).
export async function getAttPeriod(pool: Pool, month: string): Promise<AttPeriod> {
  const yearMonth = `${month}-01`;
  const [[startRow]] = await pool.query<RowDataPacket[]>(
    "SELECT att_start_end_fn(DATE_FORMAT(?, '%Y-%m-01'), 1) AS d",
    [yearMonth]
  );
  const [[endRow]] = await pool.query<RowDataPacket[]>(
    "SELECT att_start_end_fn(DATE_FORMAT(?, '%Y-%m-01'), 2) AS d",
    [yearMonth]
  );
  return { start: toISODate(startRow.d), end: toISODate(endRow.d) };
}

export const FIELD_COLUMNS = Array.from({ length: 32 }, (_, i) => `FIELD${i + 1}`);

export function fieldsToArray(row: RowDataPacket): string[] {
  return FIELD_COLUMNS.map((col) => (row[col] ?? '').toString());
}

// Mirrors registerbook()'s $lop_leave_map — approved/authorized leave transactions whose head resolves
// to occurance='LOP' (i.e. this employee's leave policy renders this leave type as LOP text, but it's
// policy-backed, not an unexplained absence). Keyed by "empFkey|date" -> sessions present (1=first half,
// 2=second half, 3=full day).
export async function getPolicyLopMap(
  pool: Pool,
  branchCode: string,
  start: string,
  end: string
): Promise<Map<string, number[]>> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT le.EMP_fkey AS emp_fkey, elt.leave_date, elt.leave_session
     FROM emp_leave_transactions elt
     INNER JOIN leaveentries le ON le.LEAVEENTRYID = elt.LEAVEENTRYID
     INNER JOIN salary_head_items shi ON shi.salary_head_item_pkey = le.salary_head_item_fkey
     INNER JOIN emp_details ed ON ed.emp_pkey = le.EMP_fkey
     WHERE elt.leave_date BETWEEN ? AND ?
       AND elt.Leavestatus IN ('Authorized', 'Approved')
       AND shi.occurance = 'LOP'
       AND ed.branch_code = ?`,
    [start, end, branchCode]
  );
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const key = `${row.emp_fkey}|${toISODate(row.leave_date)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(Number(row.leave_session));
  }
  return map;
}

export function isPolicyLeaveForDate(map: Map<string, number[]>, empFkey: number, date: string): boolean {
  return (map.get(`${empFkey}|${date}`)?.length ?? 0) > 0;
}

export interface LeaveTypeOption {
  salary_head_item_fkey: number;
  code: string;
  isIndirect: boolean;
  balance: number;
}

// Mirrors editPunch()'s view-prep: resolve an employee's policy-linked leave heads + real-time balance
// via leave_balance_inthe_year_fn (confirmed live: pemp_fkey, psalary_head_item_fkey, pleave_date -> float).
export async function getLeaveTypeOptions(pool: Pool, empFkey: number, leaveDate: string): Promise<LeaveTypeOption[]> {
  const [[proff]] = await pool.execute<RowDataPacket[]>(
    'SELECT LEAVEPOLICY_GROUP_ID FROM emp_proff WHERE emp_fkey = ?',
    [empFkey]
  );
  if (!proff?.LEAVEPOLICY_GROUP_ID) return [];

  const [heads] = await pool.execute<RowDataPacket[]>(
    `SELECT shi.salary_head_item_pkey, shi.occurance, shi.item_part
     FROM leavepolicy lp
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = lp.salary_head_item_fkey
     WHERE lp.LEAVEPOLICY_GROUP_ID = ? AND lp.status = 1 AND shi.item_type = 'Leave' AND shi.status = 1`,
    [proff.LEAVEPOLICY_GROUP_ID]
  );

  const options: LeaveTypeOption[] = [];
  for (const head of heads) {
    const [[balanceRow]] = await pool.query<RowDataPacket[]>(
      'SELECT leave_balance_inthe_year_fn(?, ?, ?) AS bal',
      [empFkey, head.salary_head_item_pkey, leaveDate]
    );
    options.push({
      salary_head_item_fkey: head.salary_head_item_pkey,
      code: (head.occurance || '').toString().toUpperCase(),
      isIndirect: head.item_part === 'Indirect',
      balance: Number(balanceRow?.bal ?? 0),
    });
  }
  return options;
}

// Checks whether an Applied/Authorized/Approved leave already exists for this date/half — mirrors
// isLeaveAlreadyApplied(). session: 1=first half, 2=second half, 3=full day (matches any half).
export async function isLeaveAlreadyApplied(
  pool: Pool | PoolConnection,
  empFkey: number,
  attDate: string,
  session: 1 | 2 | 3
): Promise<boolean> {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM emp_leave_transactions elt
     JOIN leaveentries le ON le.LEAVEENTRYID = elt.LEAVEENTRYID
     WHERE le.EMP_fkey = ? AND elt.leave_date = ? AND elt.Leavestatus IN ('Applied', 'Authorized', 'Approved')
       AND (elt.leave_session = 3 OR ? = 3 OR elt.leave_session = ?)`,
    [empFkey, attDate, session, session]
  );
  return Number(row?.cnt ?? 0) > 0;
}

const STANDARD_CODES = new Set(['P', 'A', 'WO', 'HO', 'NA', 'LOP', '']);

export function isLeaveCode(code: string): boolean {
  return !STANDARD_CODES.has((code ?? '').trim().toUpperCase());
}

// Mirrors ot_duration_register_date()'s own shift resolution: the day's effective shift is an
// emp_shift_planner override for that exact date (status=1) if one exists, else the employee's
// standing emp_proff.day_time_seq. This is the OT function's real source of truth — deliberately not
// the emp_config type='SHIFT' primary used elsewhere (shift-planner route) since that's a different
// legacy concept (roster planning UI default) from what the OT engine itself actually reads.
export async function isOtEligibleDay(pool: Pool, empFkey: number, date: string): Promise<boolean> {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT wdtp.working_time1, wdtp.min_aftr_off_dutty_cal_ot, wdtp.min_bfr_on_dutty_cal_ot, wdtp.work_time_day_off_cal_ot
     FROM emp_proff ep
     LEFT JOIN emp_shift_planner esp ON esp.emp_fkey = ep.emp_fkey AND esp.shift_date = ? AND esp.status = 1
     JOIN working_day_time_procedures wdtp ON wdtp.day_time_seq = COALESCE(esp.shift_id, ep.day_time_seq)
     WHERE ep.emp_fkey = ?`,
    [date, empFkey]
  );
  if (!row) return false;
  return (
    Number(row.working_time1) > 10 &&
    (Number(row.min_aftr_off_dutty_cal_ot) !== 0 ||
      Number(row.min_bfr_on_dutty_cal_ot) !== 0 ||
      Number(row.work_time_day_off_cal_ot) === 1)
  );
}

export interface RegisterDayContext {
  empFkey: number;
  empId: string;
  companyCode: string;
  branchCode: string;
  attDate: string;
  locked: boolean;
}

// Shared register-row lookup + verified-month lock check used by every per-day sub-resource
// (status, punches, OT) hung off attendance_register/[registerId]/day/[dayIndex].
export async function getRegisterDayContext(
  pool: Pool,
  registerId: string,
  dayIndex: number
): Promise<RegisterDayContext | null> {
  const [[reg]] = await pool.execute<RowDataPacket[]>(
    `SELECT ar.emp_fkey, ar.month_year, ar.branch_code, ar.isdelete, ed.emp_id, ed.company_code
     FROM attendance_register ar
     JOIN emp_details ed ON ed.emp_pkey = ar.emp_fkey
     WHERE ar.registerid = ?`,
    [registerId]
  );
  if (!reg) return null;
  return {
    empFkey: reg.emp_fkey,
    empId: reg.emp_id,
    companyCode: reg.company_code,
    branchCode: reg.branch_code,
    attDate: `${reg.month_year}-${String(dayIndex).padStart(2, '0')}`,
    locked: reg.isdelete === 'N',
  };
}

export interface MonthlyOt {
  pkey: number | null;
  totalMin: number;
  setMin: number | null;
  effectiveMin: number;
  isVerified: boolean;
  remarks: string | null;
}

// Batch-fetch emp_ot_master for a set of employees/month — mirrors the existing punch/daily-OT batch
// pattern in the register GET route. Monthly OT only exists once generated (see upsertMonthlyOt,
// called from the verify route) so most employees will simply have no row until then.
export async function getMonthlyOtMap(
  pool: Pool,
  empFkeys: number[],
  monthYearYYYYMM: string
): Promise<Record<number, MonthlyOt>> {
  if (empFkeys.length === 0) return {};
  const placeholders = empFkeys.map(() => '?').join(',');
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_ot_master_pkey, emp_fkey, total_duration, set_duration, is_verified, remarks
     FROM emp_ot_master
     WHERE emp_fkey IN (${placeholders}) AND DATE_FORMAT(month, '%Y-%m') = ?`,
    [...empFkeys, monthYearYYYYMM]
  );
  const map: Record<number, MonthlyOt> = {};
  for (const r of rows) {
    const totalMin = Number(r.total_duration ?? 0);
    const setMin = r.set_duration === null ? null : Number(r.set_duration);
    map[r.emp_fkey] = {
      pkey: r.emp_ot_master_pkey,
      totalMin,
      setMin,
      effectiveMin: setMin ?? totalMin,
      isVerified: r.is_verified === 'Y',
      remarks: r.remarks ?? null,
    };
  }
  return map;
}

// Ports OtAttendanceNewController::getDurationRegister()'s per-employee generation step: sums the
// month's effective daily OT (emp_ot_timeattandance, same is_manual?set_duration:ot_duration rule
// used everywhere else) and upserts it into emp_ot_master.total_duration. Skips rows already
// verified — legacy never clobbers a verified monthly OT once approved. Called from the register
// verify route right after an employee's attendance is confirmed verified, matching legacy's own
// dependency (monthly OT generation requires attendance_register.isdelete='N' for the month first).
export async function upsertMonthlyOt(
  pool: Pool,
  empFkey: number,
  empName: string,
  monthYearYYYYMM: string,
  period: AttPeriod
): Promise<void> {
  const monthDate = `${monthYearYYYYMM}-01`;
  const [[sumRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT SUM(CASE WHEN is_manual = 'Y' THEN IFNULL(set_duration, 0) ELSE IFNULL(ot_duration, 0) END) AS total
     FROM emp_ot_timeattandance
     WHERE emp_pkey = ? AND att_date BETWEEN ? AND ?`,
    [empFkey, period.start, period.end]
  );
  const totalDuration = Number(sumRow?.total ?? 0);

  const [[existing]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_ot_master_pkey FROM emp_ot_master WHERE emp_fkey = ? AND month = ?',
    [empFkey, monthDate]
  );

  if (existing) {
    await pool.execute(
      `UPDATE emp_ot_master SET total_duration = ?, set_duration = NULL
       WHERE emp_ot_master_pkey = ? AND is_verified != 'Y'`,
      [totalDuration, existing.emp_ot_master_pkey]
    );
  } else {
    await pool.execute(
      `INSERT INTO emp_ot_master (emp_fkey, emp_name, month, total_duration) VALUES (?, ?, ?, ?)`,
      [empFkey, empName, monthDate, totalDuration]
    );
  }
}

export interface DailyOt {
  otDurationMin: number | null;
  setDurationMin: number | null;
  remarks: string | null;
  isManual: boolean;
}

// Reads the day-level OT row written/refreshed by ot_duration_register_date (present once a punch
// exists for an OT-eligible day) plus any manual override from updateSetDuration()/setRemarks().
// No isdelete filter — deliberately matches updateSetDuration()/setRemarks()'s own lookup, which
// query this table by (emp_pkey, att_date) alone. isdelete on this table doesn't cleanly mean
// "active row" the way it does on attendance_register (fresh function-computed rows default to
// isdelete='Y' per the live schema's own column default, since ot_duration_register_date's INSERT
// never sets it) — filtering on it here would risk hiding real, current OT data.
export async function getDailyOt(pool: Pool, empFkey: number, date: string): Promise<DailyOt | null> {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT ot_duration, set_duration, remarks, is_manual
     FROM emp_ot_timeattandance
     WHERE emp_pkey = ? AND att_date = ?
     ORDER BY id DESC
     LIMIT 1`,
    [empFkey, date]
  );
  if (!row) return null;
  return {
    otDurationMin: row.ot_duration === null ? null : Number(row.ot_duration),
    setDurationMin: row.set_duration === null ? null : Number(row.set_duration),
    remarks: row.remarks ?? null,
    isManual: row.is_manual === 'Y',
  };
}
