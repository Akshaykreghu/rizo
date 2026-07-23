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
