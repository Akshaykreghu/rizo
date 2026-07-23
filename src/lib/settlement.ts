import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

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
  leaveBalance: number;
  holidayGroupId: number | null;
  annualCtc: number;
}

export async function getTerminationContext(pool: Pool, resignationPkey: string): Promise<TerminationContext | null> {
  const [[req]] = await pool.execute<RowDataPacket[]>(
    `SELECT rr.emp_fkey, e.branch_code, e.first_name, e.last_name,
            t.submitted_date, t.last_working_date, t.last_approved_working_date, t.notice_period,
            t.working_days_settled, t.leave_balance,
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

interface EncashableHead {
  salary_head_item_fkey: number;
  leave_encash_limit: number;
}

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

// Read-only preview of the total encashable leave balance — no writes, no procedure calls. Mirrors
// legacy's "ENCASHABLE LEAVE BALANCE" stat tile shown before HR commits to processing.
export async function previewEncashableLeaveBalance(pool: Pool, empFkey: number, leaveDate: string): Promise<number> {
  const heads = await eligibleEncashHeads(pool, empFkey);
  let total = 0;
  for (const head of heads) {
    const [[balanceRow]] = await pool.query<RowDataPacket[]>(
      'SELECT leave_balance_inthe_year_fn(?, ?, ?) AS bal',
      [empFkey, head.salary_head_item_fkey, leaveDate]
    );
    const yearlyBalance = Number(balanceRow?.bal ?? 0);
    total += Math.max(Math.min(Number(head.leave_encash_limit), yearlyBalance), 0);
  }
  return total;
}

// The commit step: mirrors legacy's leaveencash() — replaces any stale draft row, inserts a fresh
// leave_encashment_master row per eligible head, and calls leave_encash_prc to post it into the
// settlement. Returns the total days committed (should match previewEncashableLeaveBalance's number).
export async function commitLeaveEncashment(
  connection: PoolConnection,
  empFkey: number,
  branchCode: string,
  leaveDate: string,
  userId: string
): Promise<number> {
  const heads = await eligibleEncashHeads(connection, empFkey);
  if (heads.length === 0) return 0;

  const [[emp]] = await connection.execute<RowDataPacket[]>(
    'SELECT first_name, last_name FROM emp_details WHERE emp_pkey = ?',
    [empFkey]
  );
  const empName = `${emp?.first_name ?? ''} ${emp?.last_name ?? ''}`.trim();

  const [[finYear]] = await connection.execute<RowDataPacket[]>(
    `SELECT Fin_year_seq FROM fin_year
     WHERE branch_code = ? AND Year_status = 'OPEN' AND is_current_finyear = 'Y' AND status = 1
     ORDER BY Fin_year_seq DESC LIMIT 1`,
    [branchCode]
  );

  let total = 0;
  for (const head of heads) {
    const [[balanceRow]] = await connection.query<RowDataPacket[]>(
      'SELECT leave_balance_inthe_year_fn(?, ?, ?) AS bal',
      [empFkey, head.salary_head_item_fkey, leaveDate]
    );
    const yearlyBalance = Number(balanceRow?.bal ?? 0);
    const availableDays = Math.min(Number(head.leave_encash_limit), yearlyBalance);
    if (availableDays <= 0) continue;
    total += availableDays;

    await connection.execute(
      "DELETE FROM leave_encashment_master WHERE emp_fkey = ? AND salary_head_item_fkey = ? AND remarks = 'terminate' AND salary_paid = 'N'",
      [empFkey, head.salary_head_item_fkey]
    );
    const [insertResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO leave_encashment_master
         (emp_fkey, emp_name, branch_code, salary_head_item_fkey, encash_days, available_days,
          requested_days, approved_days, created_by, is_approved, approved_date, fin_year, remarks, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Y', CURDATE(), ?, 'terminate', 1)`,
      [
        empFkey, empName, branchCode, head.salary_head_item_fkey, availableDays, availableDays,
        availableDays, availableDays, userId, finYear?.Fin_year_seq ?? null,
      ]
    );
    const leaveEncashmentMasterPkey = insertResult.insertId;

    await connection.query('CALL leave_encash_prc(?, ?, ?, ?, ?)', [
      branchCode, empFkey, leaveEncashmentMasterPkey, userId, '',
    ]);
  }
  return total;
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
