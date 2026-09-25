import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
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

// Display-only collapse: "P/P", "LOP/LOP", "HO/HO", "WO/WO", "NA/NA" etc. read as a single code when
// both halves agree — purely cosmetic, the stored value and every other consumer (getCellColor,
// totals/eligibility computations, the merge logic) keep reading the full "X/X" form untouched.
export function formatStatusDisplay(rawValue: string): string {
  const value = (rawValue ?? '').trim();
  if (!value.includes('/')) return value;
  const [first, second] = value.split('/');
  return first.toUpperCase() === second.toUpperCase() ? first : value;
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
export async function getAttPeriod(pool: Pool | PoolConnection, month: string): Promise<AttPeriod> {
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

// Checks whether a leave already exists for this date/half — mirrors legacy's savenew() conflict
// check. session: 1=first half, 2=second half, 3=full day (matches any half). Status list includes
// CancellationOfAuthorized/CancellationOfApproved alongside Applied/Authorized/Approved — a
// cancellation only takes effect once actually reviewed and confirmed (see the leave cancellation
// review flow), so a leave sitting in either cancellation-pending status is still an active leave
// for conflict-checking purposes, exactly as legacy's own status list treats it.
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
     WHERE le.EMP_fkey = ? AND elt.leave_date = ?
       AND elt.Leavestatus IN ('Applied', 'Authorized', 'Approved', 'CancellationOfAuthorized', 'CancellationOfApproved')
       AND (elt.leave_session = 3 OR ? = 3 OR elt.leave_session = ?)`,
    [empFkey, attDate, session, session]
  );
  return Number(row?.cnt ?? 0) > 0;
}

const STANDARD_CODES = new Set(['P', 'A', 'WO', 'HO', 'NA', 'LOP', '']);

// Per explicit product decision: picking a leave code on a day cell (day-cell status route) is
// UI/FIELDn-display only — no leaveentries/emp_leave_transactions row is created at Save time.
// The actual leave application is deferred to here, called once per register row from
// /verify/route.ts, so a leave only becomes real once the register row is verified.
// Scans FIELD_n for each half (session 1/2), resolves the code to this employee's matching leave
// head (by occurance, same resolution getLeaveTypeOptions exposes to the day-cell modal), and
// creates+approves it via leave_transaction_prc exactly as the day-cell route used to do inline —
// skipping any half that isn't a leave code, or that already has an active leave applied.
export async function applyLeaveCodesOnVerify(
  connection: Pool | PoolConnection,
  empFkey: number,
  monthYear: string,
  fields: string[],
  calendarDays: number,
  approverId: number
): Promise<void> {
  const [[proff]] = await connection.execute<RowDataPacket[]>(
    'SELECT LEAVEPOLICY_GROUP_ID FROM emp_proff WHERE emp_fkey = ?',
    [empFkey]
  );
  if (!proff?.LEAVEPOLICY_GROUP_ID) return;

  const [heads] = await connection.execute<RowDataPacket[]>(
    `SELECT shi.salary_head_item_pkey, shi.occurance
     FROM leavepolicy lp
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = lp.salary_head_item_fkey
     WHERE lp.LEAVEPOLICY_GROUP_ID = ? AND lp.status = 1 AND shi.item_type = 'Leave' AND shi.status = 1`,
    [proff.LEAVEPOLICY_GROUP_ID]
  );
  if (heads.length === 0) return;
  const headByCode = new Map<string, number>(heads.map((h) => [String(h.occurance).toUpperCase(), h.salary_head_item_pkey]));

  for (let d = 1; d <= calendarDays; d++) {
    const raw = (fields[d - 1] ?? '').trim();
    if (!raw) continue;
    const [firstCode, secondCode] = raw.includes('/') ? raw.split('/') : [raw, raw];
    const attDate = `${monthYear}-${String(d).padStart(2, '0')}`;

    for (const [session, code] of [[1, firstCode], [2, secondCode]] as const) {
      const upper = code.trim().toUpperCase();
      if (STANDARD_CODES.has(upper)) continue;
      const salaryHeadItemFkey = headByCode.get(upper);
      if (!salaryHeadItemFkey) continue;

      const alreadyApplied = await isLeaveAlreadyApplied(connection, empFkey, attDate, session);
      if (alreadyApplied) continue;

      const fromHalf = session === 2 ? 2 : 1;
      const toHalf = session === 1 ? 1 : 2;
      const leaveDays = 0.5;

      const [insertResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO leaveentries
           (salary_head_item_fkey, applied_date, LEAVESTATUS, EMP_fkey, FROMDATE, FROMHALF, TODATE, TOHALF,
            ISAutherized, ISAutherizedby, ISAPPROVED, APPROVEDBY, Reason, leave_days)
         VALUES (?, CURDATE(), 'Approved', ?, ?, ?, ?, ?, 1, ?, 1, ?, 'Leave applied through attendance verification', ?)`,
        [salaryHeadItemFkey, empFkey, attDate, fromHalf, attDate, toHalf, approverId, approverId, leaveDays]
      );
      const leaveEntryId = insertResult.insertId;

      await connection.query('CALL leave_transaction_prc(?, ?, ?, ?, ?, ?, ?, ?, @err)', [
        leaveEntryId, empFkey, attDate, fromHalf, attDate, toHalf, leaveDays, 'Applied',
      ]);
      await connection.query('CALL leave_transaction_prc(?, ?, ?, ?, ?, ?, ?, ?, @err)', [
        leaveEntryId, empFkey, attDate, fromHalf, attDate, toHalf, leaveDays, 'Approved',
      ]);
    }
  }
}

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
  currentStatus: string;
}

// Shared register-row lookup + verified-month lock check used by every per-day sub-resource
// (status, punches, OT) hung off attendance_register/[registerId]/day/[dayIndex]. dayIndex is
// caller-validated (1-32) before this runs, so it's safe to splice into the dynamic FIELDn column name.
export async function getRegisterDayContext(
  pool: Pool,
  registerId: string,
  dayIndex: number
): Promise<RegisterDayContext | null> {
  const [[reg]] = await pool.execute<RowDataPacket[]>(
    `SELECT ar.emp_fkey, ar.month_year, ar.branch_code, ar.isdelete, ar.FIELD${dayIndex} AS current_status,
            ed.emp_id, ed.company_code
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
    currentStatus: (reg.current_status ?? '').toString(),
  };
}

// Mirrors editpunch.ctp's client-side status merge — in legacy the merge happens entirely in JS before
// it POSTs to chnagestatus(), which just does a plain `UPDATE ... SET FIELDn = <the already-merged
// value>`; reproduced here since rizo applies it server-side instead. A day cell always stores both
// halves ("X/Y"), so editing one half must preserve the other's current value rather than overwrite
// the whole cell with a bare single code.
export function mergeHalfDayStatus(
  currentValue: string,
  statusType: 'first' | 'second' | 'full',
  newCode: string
): string {
  const current = (currentValue ?? '').trim().toUpperCase();
  const code = newCode.trim().toUpperCase();

  let firstHalf: string;
  let secondHalf: string;
  if (current.includes('/')) {
    [firstHalf, secondHalf] = current.split('/').map((p) => p.trim());
  } else if (current) {
    firstHalf = current;
    secondHalf = current;
  } else {
    firstHalf = '';
    secondHalf = '';
  }

  if (statusType === 'first') firstHalf = code;
  else if (statusType === 'second') secondHalf = code;
  else { firstHalf = code; secondHalf = code; }

  // A newly-touched half with no counterpart defaults the other half to Absent, same as legacy.
  if (!firstHalf && secondHalf) firstHalf = 'A';
  if (!secondHalf && firstHalf) secondHalf = 'A';

  // Full-day Holiday/Week-off is stored as a bare single code (matches legacy's own storage
  // convention, and getCellColor()'s special-cased 'HO'/'WO' checks); every other full-day pick, and
  // any half-day edit, is stored as the doubled/combined "X/Y" form.
  if (statusType === 'full' && (code === 'HO' || code === 'WO')) return code;
  return `${firstHalf}/${secondHalf}`;
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

export interface AttendanceTotals {
  presentTotal: number;
  leaveTotal: number;
  lopTotal: number;
  wdLopTotal: number;
  lopOnly: number;
  weekoffTotal: number;
  holidayTotal: number;
  naHoCount: number;
  naWoCount: number;
  workingDays: number;
  calendarDays: number;
}

// Mirrors AttendanceRegisterNewController's totals-recompute block — registerbook() (register load),
// chnagestatus() (day-cell edit) and verifyAttendance() each independently re-derive and persist these
// from the FIELD1..32 day codes ("always calculate ... for persistent data stability" per legacy's own
// comment). The classification below is simplified from legacy's PHP: it explodes each day's status on
// '/' then matches each half against in_array() lists that include a few combined-string entries
// (e.g. 'P/A', '/WO') which can never actually match a post-split value, so only the plain single-code
// members of those lists ever fire in practice — this keeps just the reachable branches.
export function computeAttendanceTotals(
  fields: string[],
  dates: string[],
  storedCalendarDays: number | null,
  joiningDate: string | null,
  lastWorkingDate: string | null
): AttendanceTotals {
  let presentCount = 0, weekoffCount = 0, holidayCount = 0, naCount = 0, lopCount = 0, leaveCount = 0;
  let naHoCount = 0, naWoCount = 0;

  dates.forEach((date, i) => {
    const raw = (fields[i] ?? '').trim().toUpperCase();
    if (!raw) return;

    const parts = raw.split('/').map((p) => p.trim()).filter(Boolean);
    const weight = parts.length > 1 ? 0.5 : 1;
    for (const part of parts) {
      if (part === 'P') presentCount += weight;
      else if (part === 'WO') weekoffCount += weight;
      else if (part === 'HO') holidayCount += weight;
      else if (part === 'NA') naCount += weight;
      else if (part.includes('LOP')) lopCount += weight;
      else if (part !== 'A') leaveCount += weight;
    }

    // NA-period detection: before joining, or after a terminated employee's last approved working date.
    const isNaPeriod = (joiningDate != null && date < joiningDate) || (lastWorkingDate != null && date > lastWorkingDate);
    if (isNaPeriod) {
      if (raw === 'HO' || raw === 'HO/HO') naHoCount += 1;
      else if (raw === 'WO' || raw === 'WO/WO') naWoCount += 1;
      else if (raw === 'NA/HO' || raw === 'HO/NA') naHoCount += 0.5;
      else if (raw === 'NA/WO' || raw === 'WO/NA') naWoCount += 0.5;
      else if (raw === 'HO/WO' || raw === 'WO/HO') { naHoCount += 0.5; naWoCount += 0.5; }
    }
  });

  const lopOnly = lopCount;
  const lopTotal = lopOnly + naCount + naHoCount + naWoCount;
  const wdLopTotal = lopOnly + naCount;
  const calendarDays = storedCalendarDays && storedCalendarDays > 0 ? storedCalendarDays : dates.length;
  const workingDays = calendarDays - (weekoffCount + holidayCount);

  return {
    presentTotal: presentCount,
    leaveTotal: leaveCount,
    lopTotal,
    wdLopTotal,
    lopOnly,
    weekoffTotal: weekoffCount,
    holidayTotal: holidayCount,
    naHoCount,
    naWoCount,
    workingDays,
    calendarDays,
  };
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface LiveDayResult {
  date: string;
  code: string; // Same vocabulary as attendance_register.FIELDn, e.g. "P/P", "A/WO", "HO", "CL/CL".
}
export interface LiveMonthlyTotals {
  presentDays: number;
  leaveDays: number;
  lop: number;
  holidays: number;
  weekoff: number;
}

// Ports DashboardController::computeMonthlyBreakdownCounts() — legacy's live fallback for a month
// that hasn't been processed into a verified attendance_register row yet (isdelete='N'). Computes
// the same per-half (forenoon/afternoon) resolution directly from emp_detail_timeattandance +
// holidays + shift week-off config + approved/authorized leave transactions, instead of leaving the
// month blank the way attendance_register-only reads do. Returns both a per-day display code (same
// vocabulary as attendance_register.FIELDn, for the calendar) and the aggregate totals (computed
// directly, not by re-parsing the codes through computeAttendanceTotals — that parser doesn't credit
// a bare "A" toward LOP the way this live path's own arithmetic does).
export async function computeLiveAttendance(
  pool: Pool,
  empFkey: number,
  rangeStart: string,
  rangeEnd: string
): Promise<{ days: LiveDayResult[]; totals: LiveMonthlyTotals }> {
  const [[empRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT ep.joining_date, ep.emp_type, ep.day_time_seq, ep.HOLIDAY_GROUP_ID,
            t.last_approved_working_date, s.prorate_code
     FROM emp_proff ep
     LEFT JOIN termination t ON t.emp_fkey = ep.emp_fkey AND t.status = 1
     LEFT JOIN salary_structure s ON s.structure_id = ep.structure_id
     WHERE ep.emp_fkey = ?
     LIMIT 1`,
    [empFkey]
  );
  const joiningDate = empRow?.joining_date ? toISODate(empRow.joining_date) : null;
  const terminationDate = empRow?.last_approved_working_date ? toISODate(empRow.last_approved_working_date) : null;
  const shiftId = empRow?.day_time_seq ?? 0;
  const holidayGroupId = empRow?.HOLIDAY_GROUP_ID ?? 0;
  // DAILY WAGES employees exclude na_ho_count/na_wo_count from LOP, matching
  // AttendanceRegisterNewController's own salary-structure-wise rule.
  const salaryStructure = empRow?.emp_type === 'DAILY WAGES' ? 2 : Number(empRow?.prorate_code ?? 0);

  const [holidayRows] = await pool.execute<RowDataPacket[]>(
    `SELECT HOLIDAYDATE FROM holidays WHERE HOLIDAY_GROUP_ID = ? AND status = 1 AND HOLIDAYDATE BETWEEN ? AND ?`,
    [holidayGroupId, rangeStart, rangeEnd]
  );
  const holidaySet = new Set(holidayRows.map((h) => toISODate(h.HOLIDAYDATE)));

  const [[shiftRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, is_exception,
            Sunday_F, Monday_F, Tuesday_F, Wednesday_F, Thursday_F, Friday_F, Saturday_F
     FROM working_day_time_procedures WHERE day_time_seq = ?`,
    [shiftId]
  );
  const sc: Record<string, string> = shiftRow ?? {};
  const isException = String(sc.is_exception ?? '') === '1';

  const exceptionMap = new Map<string, Map<number, string>>();
  if (isException) {
    const [exRows] = await pool.execute<RowDataPacket[]>(
      `SELECT ex_week_day, ex_week, week_off FROM shift_exceptions WHERE shift_id = ? AND status = 1`,
      [shiftId]
    );
    for (const ex of exRows) {
      const day = String(ex.ex_week_day);
      if (!exceptionMap.has(day)) exceptionMap.set(day, new Map());
      exceptionMap.get(day)!.set(Number(ex.ex_week), String(ex.week_off));
    }
  }

  const [attRows] = await pool.execute<RowDataPacket[]>(
    `SELECT att_date, present FROM emp_detail_timeattandance WHERE emp_pkey = ? AND att_date BETWEEN ? AND ?`,
    [empFkey, rangeStart, rangeEnd]
  );
  const attendanceMap = new Map<string, string>();
  for (const a of attRows) attendanceMap.set(toISODate(a.att_date), (a.present ?? '').toString().trim().toUpperCase());

  const [leaveRows] = await pool.execute<RowDataPacket[]>(
    `SELECT elt.leave_date, elt.leave_session, shi.occurance
     FROM emp_leave_transactions elt
     JOIN leaveentries le ON le.LEAVEENTRYID = elt.LEAVEENTRYID
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = le.salary_head_item_fkey
     WHERE le.EMP_fkey = ? AND elt.Leavestatus IN ('Approved', 'Authorized') AND elt.leave_date BETWEEN ? AND ?`,
    [empFkey, rangeStart, rangeEnd]
  );
  // Per-day, per-half (1=forenoon, 2=afternoon) leave occurance; session 3 = full day, applies to both halves.
  const leaveMap = new Map<string, Map<number, string>>();
  for (const lq of leaveRows) {
    const date = toISODate(lq.leave_date);
    const session = Number(lq.leave_session);
    const occ = (lq.occurance ?? '').toString();
    if (!leaveMap.has(date)) leaveMap.set(date, new Map());
    const half = leaveMap.get(date)!;
    if (session === 3) { half.set(1, occ); half.set(2, occ); }
    else if (session === 1 || session === 2) half.set(session, occ);
  }

  const days: LiveDayResult[] = [];
  let presentDays = 0, leaveDays = 0, lop = 0, holidays = 0, weekoff = 0;
  let naHoCount = 0, naWoCount = 0;

  // UTC-anchored throughout (construction, getters, increment) — mixing local-time construction
  // (`new Date(s + 'T00:00:00')`) with `.toISOString()` (always UTC) silently shifts every date
  // back by a day on any server east of UTC (e.g. IST), because ISO strings with no zone suffix
  // parse as local time per the ECMAScript spec while toISOString() always prints UTC.
  const cursor = new Date(rangeStart + 'T00:00:00Z');
  const end = new Date(rangeEnd + 'T00:00:00Z');
  while (cursor <= end) {
    const attDate = cursor.toISOString().slice(0, 10);
    const dayName = WEEKDAY_NAMES[cursor.getUTCDay()];
    const dayNum = cursor.getUTCDate();
    const weekIndex = Math.ceil(dayNum / 7);
    cursor.setUTCDate(cursor.getUTCDate() + 1);

    const exceptionWo = isException ? exceptionMap.get(dayName)?.get(weekIndex) : undefined;
    const isHalfWo = exceptionWo === undefined && sc[`${dayName}_F`] === 'Y';
    const isWo = exceptionWo === 'Y' || (exceptionWo === undefined && sc[dayName] === 'N') || isHalfWo;
    const isHolidayDay = holidaySet.has(attDate);

    const present = attendanceMap.get(attDate) ?? '';
    const presentParts = present.split('/');
    const presentFirst = (presentParts[0] ?? '').trim();
    const presentSecond = (presentParts[1] !== undefined ? presentParts[1] : presentFirst).trim();
    let presentHalves: Record<1 | 2, string> = { 1: presentFirst, 2: presentSecond };

    const hasLeave = leaveMap.has(attDate);
    const isNaPeriod = (joiningDate != null && attDate < joiningDate) || (terminationDate != null && attDate > terminationDate);
    if (isNaPeriod) {
      if (isHolidayDay) { presentHalves = { 1: 'NA', 2: 'HO' }; naHoCount += 0.5; }
      else if (isWo) { presentHalves = { 1: 'NA', 2: 'WO' }; naWoCount += 0.5; }
      else { presentHalves = { 1: 'NA', 2: 'NA' }; }
    }

    const codes: string[] = [];
    for (const half of [1, 2] as const) {
      const punchCode = presentHalves[half];
      const leaveOcc = leaveMap.get(attDate)?.get(half);
      let code: string;
      if (punchCode === 'WO') { weekoff += 0.5; code = 'WO'; }
      else if (punchCode === 'HO') { holidays += 0.5; code = 'HO'; }
      else if (punchCode === 'NA') { lop += 0.5; code = 'NA'; }
      else if (isWo && isHalfWo && half === 2) { weekoff += 0.5; code = 'WO'; }
      else if (isWo && !isHalfWo) { weekoff += 0.5; code = 'WO'; }
      else if (isHolidayDay) { holidays += 0.5; code = 'HO'; }
      else if (hasLeave && leaveOcc !== undefined && leaveOcc !== 'LOP') { leaveDays += 0.5; code = leaveOcc; }
      else if (hasLeave && leaveOcc !== undefined) { lop += 0.5; code = 'LOP'; }
      else if (punchCode === 'P') { presentDays += 0.5; code = 'P'; }
      else { lop += 0.5; code = 'A'; }
      codes.push(code);
    }

    days.push({ date: attDate, code: codes.join('/') });
  }

  if (salaryStructure !== 2) lop += naHoCount + naWoCount;

  return { days, totals: { presentDays, leaveDays, lop, holidays, weekoff } };
}

// Batch-fetch the two NA-period inputs computeAttendanceTotals needs beyond the register row itself:
// joining_date (emp_proff) and, only for a terminated employee, last_approved_working_date (termination).
export async function getNaPeriodBounds(
  pool: Pool | PoolConnection,
  empFkeys: number[]
): Promise<Record<number, { joiningDate: string | null; lastWorkingDate: string | null }>> {
  const result: Record<number, { joiningDate: string | null; lastWorkingDate: string | null }> = {};
  if (empFkeys.length === 0) return result;
  const placeholders = empFkeys.map(() => '?').join(',');

  const [proffRows] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_fkey, joining_date FROM emp_proff WHERE emp_fkey IN (${placeholders})`,
    empFkeys
  );
  for (const r of proffRows) {
    result[r.emp_fkey] = { joiningDate: r.joining_date ? toISODate(r.joining_date) : null, lastWorkingDate: null };
  }

  const [termRows] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_fkey, last_approved_working_date FROM termination WHERE status = 1 AND emp_fkey IN (${placeholders})`,
    empFkeys
  );
  for (const r of termRows) {
    if (!result[r.emp_fkey]) result[r.emp_fkey] = { joiningDate: null, lastWorkingDate: null };
    result[r.emp_fkey].lastWorkingDate = r.last_approved_working_date ? toISODate(r.last_approved_working_date) : null;
  }

  return result;
}

export async function saveAttendanceTotals(
  pool: Pool | PoolConnection,
  registerId: number,
  totals: AttendanceTotals
): Promise<void> {
  await pool.execute(
    `UPDATE attendance_register SET
       presant_total = ?, leave_total = ?, lop_total = ?, wd_lop_total = ?, lop_only = ?,
       weekoff_total = ?, holiday_total = ?, na_ho_count = ?, na_wo_count = ?, working_days = ?, calander_days = ?
     WHERE registerid = ?`,
    [
      totals.presentTotal, totals.leaveTotal, totals.lopTotal, totals.wdLopTotal, totals.lopOnly,
      totals.weekoffTotal, totals.holidayTotal, totals.naHoCount, totals.naWoCount, totals.workingDays, totals.calendarDays,
      registerId,
    ]
  );
}

// Self-contained recompute for a single register row — fetches everything itself, for call sites
// (the day-edit route) that don't already have the row's FIELD values loaded. GET/verify already load
// FIELD1..32 + calander_days for every row in view, so they call computeAttendanceTotals directly and
// save via saveAttendanceTotals instead of re-fetching here.
export async function recalcAttendanceRegisterTotals(
  pool: Pool | PoolConnection,
  registerId: number
): Promise<AttendanceTotals | null> {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_fkey, month_year, calander_days, ${FIELD_COLUMNS.join(', ')} FROM attendance_register WHERE registerid = ?`,
    [registerId]
  );
  if (!row) return null;

  const period = await getAttPeriod(pool, row.month_year);
  const calendarDayCount = Math.round(
    (new Date(period.end).getTime() - new Date(period.start).getTime()) / 86400000
  ) + 1;
  const dates = Array.from({ length: calendarDayCount }, (_, i) => {
    const d = new Date(period.start);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const fields = fieldsToArray(row);

  const bounds = await getNaPeriodBounds(pool, [row.emp_fkey]);
  const { joiningDate, lastWorkingDate } = bounds[row.emp_fkey] ?? { joiningDate: null, lastWorkingDate: null };

  const totals = computeAttendanceTotals(fields, dates, Number(row.calander_days) || null, joiningDate, lastWorkingDate);
  await saveAttendanceTotals(pool, registerId, totals);
  return totals;
}
