import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { evaluateArithmetic } from './salaryFormula';

// Shared helpers for the Remove Employee / Full & Final settlement flow, split across:
// - GET .../preview (read-only: Resignation Details + Notice Period Adjustment stats + Loans/Assets,
//   mirrors legacy's setup() screen before anything is computed)
// - PUT .../approve (the commit step: leave encashment + final_settle_pay_prc + settlement read-back,
//   mirrors legacy's separate "Process Full and Final" button inside that screen)

// mysql2 returns DATE columns as JS Date objects (no dateStrings config on the pool) — String(date)
// gives a locale toString(), not ISO, which silently corrupts date-string comparisons/arithmetic.
export function toISODate(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export interface TerminationContext {
  empFkey: number;
  branchCode: string;
  firstName: string;
  lastName: string | null;
  submittedDate: string;
  lastWorkingDate: string;
  lastApprovedWd: string;
  noticePeriod: number;
  workingDaysSettled: number;
  payrollDays: number;
  encashedDays: number;
  actLastWorkingDay: string | null;
  leaveBalance: number;
  holidayGroupId: number | null;
  annualCtc: number;
}

export async function getTerminationContext(pool: Pool, resignationPkey: string): Promise<TerminationContext | null> {
  const [[req]] = await pool.execute<RowDataPacket[]>(
    `SELECT rr.emp_fkey, e.branch_code, e.first_name, e.last_name,
            t.submitted_date, t.last_working_date, t.last_approved_working_date, t.notice_period,
            t.working_days_settled, t.payroll_days, t.encashed_days, t.act_last_working_day,
            t.leave_balance,
            p.HOLIDAY_GROUP_ID, ctc.emp_anual_ctc
     FROM resignation_requests rr
     JOIN emp_details e ON e.emp_pkey = rr.emp_fkey
     LEFT JOIN termination t ON t.Resignation_pkey = rr.Resignation_pkey AND t.status = 1
     LEFT JOIN emp_proff p ON p.emp_fkey = rr.emp_fkey
     LEFT JOIN emp_ctc_upload ctc ON ctc.emp_fkey = rr.emp_fkey AND ctc.status = 1
     WHERE rr.Resignation_pkey = ? AND rr.status = 1
     ORDER BY ctc.emp_ctc_upload_pkey DESC LIMIT 1`,
    [resignationPkey]
  );
  if (!req) return null;

  return {
    empFkey: req.emp_fkey,
    branchCode: req.branch_code,
    firstName: req.first_name,
    lastName: req.last_name,
    submittedDate: toISODate(req.submitted_date),
    lastWorkingDate: toISODate(req.last_working_date),
    lastApprovedWd: toISODate(req.last_approved_working_date),
    noticePeriod: Number(req.notice_period ?? 0),
    workingDaysSettled: Number(req.working_days_settled ?? 0),
    payrollDays: Number(req.payroll_days ?? 0),
    // termination.encashed_days is written only by final_settle_pay_prc inside the DB — no legacy
    // PHP path sets it — so it reads 0 until that procedure runs to completion (it currently bails
    // on "Attendance not verified"). Surfaced as-is on the slip, matching legacy.
    encashedDays: Number(req.encashed_days ?? 0),
    actLastWorkingDay: req.act_last_working_day ? toISODate(req.act_last_working_day) : null,
    leaveBalance: Number(req.leave_balance ?? 0),
    holidayGroupId: req.HOLIDAY_GROUP_ID ?? null,
    annualCtc: Number(req.emp_anual_ctc ?? 0),
  };
}

export interface DayCountStats {
  offsActual: number;
  resignationPeriodWorkingDays: number;
  resignationPeriodPresentDays: number;
  balanceWorkingDays: number;
}

// Mirrors setup()'s offs_actual/resignation_period_working_days. presantDays defaults to 0 for the
// preview (matches legacy's screen before attendance/present-days are known) and is admin-supplied
// at commit time.
export async function computeDayCountStats(
  pool: Pool | PoolConnection,
  ctx: TerminationContext,
  presantDays: number
): Promise<DayCountStats> {
  const submittedReduced = new Date(ctx.submittedDate);
  submittedReduced.setDate(submittedReduced.getDate() - 1);
  const lastWorkingIncreased = new Date(ctx.lastApprovedWd);
  lastWorkingIncreased.setDate(lastWorkingIncreased.getDate() + 1);

  const [[weekoffRow]] = await pool.query<RowDataPacket[]>(
    'SELECT weekoff_days_count_fn(?, ?, ?) AS no_of_weekoff',
    [ctx.empFkey, lastWorkingIncreased.toISOString().slice(0, 10), submittedReduced.toISOString().slice(0, 10)]
  );
  const [[holidayRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS days_count FROM holidays
     WHERE HOLIDAY_GROUP_ID = ? AND HOLIDAYDATE BETWEEN ? AND ? AND status = 1`,
    [ctx.holidayGroupId, ctx.submittedDate, ctx.lastApprovedWd]
  );
  const offsActual = Math.abs(Number(weekoffRow?.no_of_weekoff ?? 0)) + Number(holidayRow?.days_count ?? 0);
  const resignationPeriodWorkingDays = ctx.noticePeriod > 0 ? Math.max(ctx.noticePeriod - offsActual, 0) : 0;
  const balanceWorkingDays = Math.max(resignationPeriodWorkingDays - presantDays, 0);

  return { offsActual, resignationPeriodWorkingDays, resignationPeriodPresentDays: presantDays, balanceWorkingDays };
}

export function computeNoticePay(ctx: TerminationContext, offsActual: number): number {
  const perDaySalary = ctx.noticePeriod > 0 ? (ctx.annualCtc / 12) / ctx.noticePeriod : ctx.annualCtc / 12 / 30;
  const afterAdjustment = Math.max(ctx.noticePeriod - offsActual - ctx.workingDaysSettled - ctx.leaveBalance, 0);
  return Math.round(0 - afterAdjustment * perDaySalary);
}

// Mirrors legacy removeemps() (the non-KWMT/GRTL path), which computes these two figures itself
// rather than taking them from a form:
//   diffDays          = date_diff(last_approved_working_date + 1 day, submitted_date)
//   offs              = |weekoff_days_count_fn(emp, approved+1, submitted-1)| + holidays(submitted..approved)
//   if offs > 0       → offs += 1
//   working_days_settled = diffDays - offs
//   payroll_days         = diffDays - (LOP_days + offs)
// LOP_days comes from emp_detail_timeattandance; where that table is empty it resolves to 0, so
// payroll_days degrades to working_days_settled — the same honest fallback used elsewhere until
// Attendance exists. Holidays are counted without a status filter, matching removeemps() exactly
// (setup()'s equivalent does filter status = 1; removeemps() does not).
export async function computeRemovalDays(
  pool: Pool | PoolConnection,
  ctx: TerminationContext
): Promise<{ workingDaysSettled: number; payrollDays: number }> {
  const submitted = new Date(ctx.submittedDate);
  const approved = new Date(ctx.lastApprovedWd);
  const submittedReduced = new Date(submitted); submittedReduced.setDate(submittedReduced.getDate() - 1);
  const approvedIncreased = new Date(approved); approvedIncreased.setDate(approvedIncreased.getDate() + 1);

  const diffDays = Math.round((approvedIncreased.getTime() - submitted.getTime()) / 86_400_000);

  const [[weekoffRow]] = await pool.query<RowDataPacket[]>(
    'SELECT weekoff_days_count_fn(?, ?, ?) AS no_of_weekoff',
    [ctx.empFkey, approvedIncreased.toISOString().slice(0, 10), submittedReduced.toISOString().slice(0, 10)]
  );
  const [[holidayRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS days_count FROM holidays
     WHERE HOLIDAY_GROUP_ID = ? AND HOLIDAYDATE BETWEEN ? AND ?`,
    [ctx.holidayGroupId, ctx.submittedDate, ctx.lastApprovedWd]
  );
  let offs = Math.abs(Number(weekoffRow?.no_of_weekoff ?? 0)) + Number(holidayRow?.days_count ?? 0);
  if (offs > 0) offs += 1;

  // LOP days in the resignation window (full-day LOP counts 1, half-day LOP counts 0.5).
  const [[lopRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT ROUND(SUM(a), 1) AS lop FROM (
       SELECT COUNT(*) AS a FROM emp_detail_timeattandance
        WHERE others IN ('LOP', 'LOP/LOP') AND emp_pkey = ? AND att_date BETWEEN ? AND ?
       UNION ALL
       SELECT COUNT(*) / 2 AS a FROM emp_detail_timeattandance
        WHERE (INSTR(others, '/LOP') > 0 OR INSTR(others, 'LOP/') > 0) AND others <> 'LOP'
          AND emp_pkey = ? AND att_date BETWEEN ? AND ?
     ) ass`,
    [ctx.empFkey, ctx.submittedDate, ctx.lastApprovedWd, ctx.empFkey, ctx.submittedDate, ctx.lastApprovedWd]
  );
  const lopDays = Number(lopRow?.lop ?? 0);

  return {
    workingDaysSettled: diffDays - offs,
    payrollDays: diffDays - (lopDays + offs),
  };
}

interface EncashableHead {
  salary_head_item_fkey: number;
  leave_encash_limit: number;
}

// PHP round($x, 1). Balances here are effectively always non-negative, so half-up vs half-away is moot.
const round1 = (n: number) => Math.round(n * 10) / 10;

// The head set legacy leaveencash() iterates ($salary_head_items): is_leave_encash='Y' AND
// leave_encash_limit IS NOT NULL AND status=1, scoped to the employee's leave-policy group.
async function eligibleEncashHeads(pool: Pool | PoolConnection, empFkey: number): Promise<EncashableHead[]> {
  const [[proff]] = await pool.execute<RowDataPacket[]>(
    'SELECT LEAVEPOLICY_GROUP_ID FROM emp_proff WHERE emp_fkey = ?',
    [empFkey]
  );
  if (!proff?.LEAVEPOLICY_GROUP_ID) return [];

  const [heads] = await pool.execute<RowDataPacket[]>(
    `SELECT salary_head_item_fkey, leave_encash_limit FROM leavepolicy
     WHERE LEAVEPOLICY_GROUP_ID = ? AND is_leave_encash = 'Y' AND leave_encash_limit IS NOT NULL AND status = 1`,
    [proff.LEAVEPOLICY_GROUP_ID]
  );
  return heads as unknown as EncashableHead[];
}

// The LOOSER head set legacy workingattendnacedays() sums for its "leave" tile ($leavepolicy_encashed):
// SELECT DISTINCT salary_head_item_fkey FROM leavepolicy WHERE is_leave_encash='Y' AND <emp's group> —
// note: NO leave_encash_limit IS NOT NULL filter and NO status filter, unlike eligibleEncashHeads().
async function encashTileHeads(pool: Pool | PoolConnection, empFkey: number): Promise<number[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT DISTINCT salary_head_item_fkey FROM leavepolicy
     WHERE is_leave_encash = 'Y'
       AND LEAVEPOLICY_GROUP_ID IN (SELECT LEAVEPOLICY_GROUP_ID FROM emp_proff WHERE emp_fkey = ?)`,
    [empFkey]
  );
  return rows.map((r) => Number(r.salary_head_item_fkey));
}

// Mirrors legacy workingattendnacedays()'s leave-year check: if no OPEN current financial year
// exists for the employee's branch, it surfaces "you need to provide a Leave Year for this
// Employee" on the Process Full & Final screen. Returns true when a usable leave year exists.
export async function hasCurrentLeaveYear(pool: Pool | PoolConnection, branchCode: string): Promise<boolean> {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM fin_year
     WHERE branch_code = ? AND Year_status = 'OPEN' AND is_current_finyear = 'Y' AND vattr1 = 0 AND status = 1
     LIMIT 1`,
    [branchCode]
  );
  return Boolean(row);
}

// leave_balance_inthe_year_fn's 3rd parameter (`pleave_date date`): legacy's workingattendnacedays()
// / leaveencash() pass fin_year.fin_year here — an int like 2026 — into a DATE parameter. Under this
// deployment's sql_mode that raises ER_TRUNCATED_WRONG_VALUE ('Incorrect date value: 2026'); under a
// lax mode it degrades to a zero/NULL date. The function's own documented fallback is
// `IF pleave_date IS NULL THEN SET pleave_date = CURRENT_DATE`, so we pass NULL — the same effective
// leave year legacy intends ("the current one"), without the type error. Callers therefore hand the
// function a literal null for this argument.

// Ports approves()'s post-final_settle_pay_prc formula re-evaluation for the non-KWMT path:
//
//   Pass A (lines 564-575) — emp_settle_slip: every row still carrying an arithmetic expression in
//     `remarks` (status = 'Y', action = 'P') is recomputed and its salary_amount/salary_rate
//     overwritten. No sign handling, no ESI rule. Returns the payroll_master_fkey of the LAST row
//     seen (legacy leaks this variable into Pass B regardless of whether that row had a formula).
//
//   Pass B (lines 577-627) — emp_salary_slip: only when Pass A's leaked payroll_master_fkey > 0.
//     Re-evaluates that payroll slip's rows with a non-null `remarks` and end_date_effective IS
//     NULL; ESI heads are ceil()'d, others round()'d, and a 'Deduction' head_operator flips the
//     sign.
//
// Legacy uses PHP eval(); we use the project's safe arithmetic evaluator (digits and + - * / ( )
// only) and skip any row whose remarks are not a plain arithmetic expression.
export async function reevalSettleSlipFormulas(
  connection: PoolConnection,
  empFkey: number
): Promise<number | null> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT emp_settle_slip_pkey, remarks, payroll_master_fkey FROM emp_settle_slip WHERE emp_fkey = ? AND status = 'Y' AND action = 'P'",
    [empFkey]
  );
  let lastPayrollMasterFkey: number | null = null;
  for (const row of rows) {
    lastPayrollMasterFkey = row.payroll_master_fkey == null ? null : Number(row.payroll_master_fkey);
    const raw = String(row.remarks ?? '').replace(/\s+/g, '');
    if (!raw) continue;
    let value: number;
    try {
      value = evaluateArithmetic(raw);
    } catch {
      continue; // not a plain arithmetic expression — leave the row untouched
    }
    await connection.execute(
      'UPDATE emp_settle_slip SET salary_rate = ?, salary_amount = ? WHERE emp_settle_slip_pkey = ? AND emp_fkey = ?',
      [value, value, row.emp_settle_slip_pkey, empFkey]
    );
  }
  return lastPayrollMasterFkey;
}

export async function reevalSalarySlipFormulas(
  connection: PoolConnection,
  payrollMasterFkey: number
): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT emp_salary_slip_pkey, head_operator, remarks, salary_head_item_desc
     FROM emp_salary_slip
     WHERE payroll_master_fkey = ? AND remarks IS NOT NULL AND end_date_effective IS NULL`,
    [payrollMasterFkey]
  );
  for (const row of rows) {
    const raw = String(row.remarks ?? '').replace(/\s+/g, '');
    if (!raw) continue;
    let n: number;
    try {
      n = evaluateArithmetic(raw);
    } catch {
      continue;
    }
    // Non-KWMT approves() special-cases the exact string 'esi' only.
    const isEsi = String(row.salary_head_item_desc ?? '').trim().toLowerCase() === 'esi';
    let value = isEsi ? Math.ceil(n) : Math.round(n);
    if (String(row.head_operator) === 'Deduction') value = -value;
    await connection.execute(
      'UPDATE emp_salary_slip SET salary_rate = ?, salary_amount = ? WHERE emp_salary_slip_pkey = ?',
      [value, value, row.emp_salary_slip_pkey]
    );
  }
}

// Read-only preview of the total encashable leave balance — no writes, no procedure calls. This is
// the exact figure legacy workingattendnacedays() returns as `leave` and paints on the Process Full
// & Final screen, and which approves() then forwards to leaveencash() as $applied:
//   $leavebalance = Σ round(leave_balance_inthe_year_fn(emp, head, finyear), 1)  over encashTileHeads
// No leave_encash_limit cap, no per-head floor at 0 — the raw per-year balance of every is_leave_encash
// head, rounded to 1 dp and summed. (3rd fn arg NULL → CURRENT_DATE fallback, see the note above.)
export async function previewEncashableLeaveBalance(pool: Pool | PoolConnection, empFkey: number): Promise<number> {
  const heads = await encashTileHeads(pool, empFkey);
  let total = 0;
  for (const headFkey of heads) {
    const [[balanceRow]] = await pool.query<RowDataPacket[]>(
      'SELECT leave_balance_inthe_year_fn(?, ?, ?) AS bal',
      [empFkey, headFkey, null]
    );
    total += round1(Number(balanceRow?.bal ?? 0));
  }
  return total;
}

// The commit step: faithful port of legacy leaveencash($emp, $applied, 0) — non-KWMT. Every legacy
// quirk is reproduced verbatim (the user's directive: "Follow the legacy logic"):
//
//  - It fetches $salary_head_items (eligibleEncashHeads) and `foreach`es it, but the loop body ALWAYS
//    reads $salary_head_items[0]; the iterator value is ignored. So each iteration processes head[0].
//  - The inserted row's salary_head_item_fkey is the literal 0 — never the real head fkey.
//  - encash_days = head[0].leave_encash_limit; available_days = min(that, head[0] yearly balance).
//  - requested_days = approved_days = $applied — the screen's ENCASHABLE LEAVE BALANCE tile total
//    (previewEncashableLeaveBalance), NOT the per-head available figure.
//  - approved_by = '0', is_approved = 'Y', approved_date = creation_date = today; fin_year/status are
//    left to their column defaults (NULL / 1), exactly as legacy's $arr_data omits them.
//  - Each iteration first DELETEs *all* unpaid remarks='terminate' rows for the employee (not
//    head-scoped) and only then inserts. For an employee with >1 encashable head this means only the
//    final iteration's leave_encashment_master row survives, while leave_encash_prc still fires once
//    per iteration — so emp_encash_slip accrues an orphan row (pointing at a since-deleted master)
//    for every head after the first. This is a known legacy data quirk; kept for parity. Single-head
//    employees (the norm) are unaffected.
//
// `applied` is the tile total the caller must pass in (legacy: the $leaves URL arg of approves()).
// Returns that same figure.
export async function commitLeaveEncashment(
  connection: PoolConnection,
  empFkey: number,
  branchCode: string,
  userId: string,
  applied: number
): Promise<number> {
  const heads = await eligibleEncashHeads(connection, empFkey);
  if (heads.length === 0) return 0;

  const [[emp]] = await connection.execute<RowDataPacket[]>(
    'SELECT first_name, last_name FROM emp_details WHERE emp_pkey = ?',
    [empFkey]
  );
  const empName = `${emp?.first_name ?? ''} ${emp?.last_name ?? ''}`.trim();

  const head0 = heads[0];
  const encashLimit = Number(head0.leave_encash_limit);

  for (let i = 0; i < heads.length; i++) {
    const [[balanceRow]] = await connection.query<RowDataPacket[]>(
      // 3rd arg NULL — leave_balance_inthe_year_fn falls back to CURRENT_DATE, see the note above.
      'SELECT leave_balance_inthe_year_fn(?, ?, ?) AS bal',
      [empFkey, head0.salary_head_item_fkey, null]
    );
    const yearlyBalance = Number(balanceRow?.bal ?? 0);
    const availableDays = Math.min(encashLimit, yearlyBalance);

    await connection.execute(
      "DELETE FROM leave_encashment_master WHERE remarks = 'terminate' AND emp_fkey = ? AND salary_paid = 'N'",
      [empFkey]
    );
    const [insertResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO leave_encashment_master
         (emp_fkey, emp_name, branch_code, salary_head_item_fkey, encash_days, available_days,
          requested_days, approved_days, created_by, creation_date, modified_by,
          remarks, approved_by, is_approved, approved_date)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, CURDATE(), ?, 'terminate', '0', 'Y', CURDATE())`,
      [empFkey, empName, branchCode, encashLimit, availableDays, applied, applied, userId, userId]
    );
    const leaveEncashmentMasterPkey = insertResult.insertId;

    // Legacy passes literal '0' for puser_id and the literal string '@msg' for perr_msg (the proc
    // reads neither); mirrored here.
    await connection.query('CALL leave_encash_prc(?, ?, ?, ?, ?)', [
      branchCode, empFkey, leaveEncashmentMasterPkey, '0', '@msg',
    ]);
  }
  return applied;
}

// Assets still allocated to the employee (to be retrieved before Full & Final) — mirrors legacy
// FullandFinalsettlement::Assets(): asset_allocate ⨝ asset_management on status = 'Allocated'.
// asset_allocate carries its own denormalised name/serial columns; asset_management is the
// preferred source, falling back to the allocation row's own copies.
export async function getAllocatedAssets(pool: Pool | PoolConnection, empFkey: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT a.allocate_pkey,
            COALESCE(NULLIF(m.name, ''), a.asset_name) AS name,
            m.Type AS type,
            COALESCE(NULLIF(m.serial_no, ''), a.s_no) AS serial_no,
            a.allocated_date
     FROM asset_allocate a
     LEFT JOIN asset_management m ON m.asset_pkey = a.asset
     WHERE a.emp_fkey = ? AND a.status = 'Allocated'
     ORDER BY a.allocate_pkey`,
    [empFkey]
  );
  return rows;
}

// Read-only Loans/Assets reference panels — no auto-netting, matches legacy precedent (HR manually
// accounts for these via a generic deduction elsewhere).
export async function getLoansAndAssets(pool: Pool | PoolConnection, empFkey: number) {
  const [loans] = await pool.execute<RowDataPacket[]>(
    "SELECT emp_loan_pkey, loan_amount, tenure, emi_amount FROM emp_loan WHERE emp_fkey = ? AND is_completed = 'N' AND status = 1",
    [empFkey]
  );
  const loansWithBalance = await Promise.all(
    loans.map(async (loan) => {
      const [[balance]] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM emp_loan_info WHERE emp_loan_info_pkey IN
           (SELECT min(emp_loan_info_pkey) FROM emp_loan_info WHERE loan_pkey = ? AND amount_paid = 0 AND status = 1)
         AND status = 1 AND paid_status != 'P'`,
        [loan.emp_loan_pkey]
      );
      return { ...loan, opening_balance: balance?.opening_balance ?? null, closing_balance: balance?.closing_balance ?? null };
    })
  );
  const [assets] = await pool.execute<RowDataPacket[]>(
    `SELECT a.allocate_pkey, a.asset_name, a.damaged_amout, m.name AS catalog_name
     FROM asset_allocate a LEFT JOIN asset_management m ON m.asset_pkey = a.asset
     WHERE a.emp_fkey = ? AND a.damaged_amout IS NOT NULL`,
    [empFkey]
  );
  return { loans: loansWithBalance, assets };
}
