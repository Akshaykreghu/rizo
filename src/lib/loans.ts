import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { isPayrollAlreadyProcessed } from './payroll';

// Accepted by any helper that must also be callable inside a caller-managed transaction (both
// Pool and PoolConnection expose the same .execute() surface used throughout this file).
type Queryable = Pool | PoolConnection;

// Thrown for the business-rule guards legacy enforces before a write (over-balance payment,
// payroll-already-processed, month-out-of-range). Routes map this to HTTP 400 with `.message`.
export class LoanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoanValidationError';
  }
}

// Shared helpers for Employee Loans (EmployeeLoanController.php port). Verified live:
// emp_loan/emp_loan_info schemas, and the real employeeloansave() EMI-generation algorithm read
// directly from source. Creation == approval in legacy (no workflow) — replicated as-is. EMI rows
// are pre-generated in full at creation time (not lazily per month), matching legacy exactly.
//
// Note on the "0% interest static balance" bug flagged during research: re-reading
// employeeloansave() directly shows the *primary* single-loan creation path amortizes correctly
// (closing_balance is carried into the next iteration's opening_balance even at 0% interest) — the
// static-balance anomaly seen in live sample data traces to the separate bulk-Excel-upload path
// (uploadandsaveempctc(), which duplicates this loop inline), which is not being ported. So this
// file implements the real, correct primary-path algorithm; no bug needed replicating here.

export interface LoanInput {
  empFkey: number;
  loanAmount: number;
  tenure: number;
  interestRate: number;
  emiStartMonth: string; // 'YYYY-MM'
  remarks?: string;
}

function computeEmi(loanAmount: number, tenure: number, interestRate: number): number {
  if (interestRate > 0) {
    const r = interestRate / 100 / 12;
    const emi = (loanAmount * r * Math.pow(1 + r, tenure)) / (Math.pow(1 + r, tenure) - 1);
    return Math.floor(emi);
  }
  return loanAmount / tenure;
}

function addMonths(monthStr: string, n: number): string {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Mirrors EmployeeLoanController::employeeloansave() exactly, including its rounding-remainder
// handling (the last month absorbs whatever `round(emi) * tenure` under/over-shoots loan_amount by).
export async function createLoan(pool: Queryable, input: LoanInput, userId: string): Promise<number> {
  const emi = computeEmi(input.loanAmount, input.tenure, input.interestRate);
  const emiEndMonth = addMonths(input.emiStartMonth, input.tenure - 1);

  const [header] = await pool.execute<ResultSetHeader>(
    `INSERT INTO emp_loan
       (emp_fkey, loan_amount, tenure, intrest_rate, emi_amount, emi_start_month, emi_end_month,
        remarks, is_completed, created_by, modified_by, modified_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'N', ?, ?, NOW(), 1)`,
    [
      input.empFkey, input.loanAmount, input.tenure, input.interestRate, emi,
      input.emiStartMonth, emiEndMonth, input.remarks ?? null, userId, userId,
    ]
  );
  const loanPkey = header.insertId;

  let closingBalance = input.loanAmount;
  let tempOpeningBalance = emi * input.tenure;
  let month = input.emiStartMonth;
  let lastMonth = month;

  for (let i = 0; i < input.tenure; i++) {
    const openingBalance = closingBalance;
    const interestPaid = (openingBalance * input.interestRate) / 100 / 12;
    const principal = emi - interestPaid;
    closingBalance = openingBalance - principal;
    lastMonth = month;

    if (Math.round(emi) > tempOpeningBalance) {
      const remarks = `EMI for the month Rs.${Math.round(tempOpeningBalance)}`;
      await pool.execute(
        `INSERT INTO emp_loan_info
           (opening_balance, emp_fkey, loan_type, loan_pkey, loan_month, loan_tenure, closing_balance,
            principle, interest, amount_to_paid, loan_emi, amount_paid, created_by, remarks)
         VALUES (?, ?, 'Loan', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          Math.round(tempOpeningBalance), input.empFkey, loanPkey, month, input.tenure,
          Math.round(closingBalance), Math.round(tempOpeningBalance), Math.round(interestPaid),
          Math.round(tempOpeningBalance), Math.round(tempOpeningBalance), userId, remarks,
        ]
      );
    } else {
      const remarks = `EMI for the month Rs.${Math.round(emi)}`;
      await pool.execute(
        `INSERT INTO emp_loan_info
           (opening_balance, emp_fkey, loan_type, loan_pkey, loan_month, loan_tenure, closing_balance,
            principle, interest, amount_to_paid, loan_emi, amount_paid, created_by, remarks)
         VALUES (?, ?, 'Loan', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          Math.round(openingBalance), input.empFkey, loanPkey, month, input.tenure,
          Math.round(closingBalance), Math.round(principal), Math.round(interestPaid),
          Math.round(emi), Math.round(emi), userId, remarks,
        ]
      );
    }

    month = addMonths(month, 1);
    tempOpeningBalance -= Math.round(emi);
  }

  if (tempOpeningBalance > 0) {
    const finalEmi = Math.round(emi) + tempOpeningBalance;
    const remarks = `EMI for the month Rs.${finalEmi}`;
    await pool.execute(
      `UPDATE emp_loan_info SET principle = ?, amount_to_paid = ?, loan_emi = ?, remarks = ?, closing_balance = 0
       WHERE loan_month = ? AND loan_pkey = ? AND status = 1`,
      [finalEmi, finalEmi, finalEmi, remarks, lastMonth, loanPkey]
    );
  }

  return loanPkey;
}

export interface LoanListParams {
  empFkey?: number;
  branchCode?: string;
  month?: string;
}

// Mirrors EmployeeLoanController::employeeloanlist() — shows completed and incomplete loans
// together (legacy has no status filter wired despite commented-out code for one).
export async function listLoans(pool: Pool, params: LoanListParams) {
  const conditions: string[] = ['au.status = 1', 'ed.status = 1'];
  const args: (string | number)[] = [];
  if (params.empFkey) { conditions.push('au.emp_fkey = ?'); args.push(params.empFkey); }
  if (params.branchCode) { conditions.push('ed.branch_code = ?'); args.push(params.branchCode); }
  if (params.month) { conditions.push('au.emi_start_month = ?'); args.push(params.month); }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT au.emp_loan_pkey, au.emp_fkey, au.loan_amount, au.tenure, au.intrest_rate, au.emi_amount,
            au.emi_start_month, au.emi_end_month, au.remarks, au.is_completed, au.created_date,
            CONCAT(COALESCE(ed.first_name,''),' ',COALESCE(ed.last_name,'')) AS emp_name,
            (SELECT SUM(amount_paid) FROM emp_loan_info WHERE loan_pkey = au.emp_loan_pkey) AS loan_paid
     FROM emp_details ed
     JOIN emp_loan au ON ed.emp_pkey = au.emp_fkey
     WHERE ${conditions.join(' AND ')}
     ORDER BY au.created_date DESC`,
    args
  );
  return rows;
}

export interface LoanScheduleRow {
  emp_loan_info_pkey: number;
  sl_no: number;
  loan_month: string;      // 'YYYY-MM'
  opening_balance: number;
  loan_emi: number;
  amount_paid: number;
  closing_balance: number;
  monthly_status: string;  // legacy `remarks`
  user_remarks: string;
  paid_status: string;
  emi_transfer: string;
}

export interface LoanDetail {
  emp_loan_pkey: number;
  emp_fkey: number;
  emp_name: string;
  emp_company_id: string | null;
  loan_amount: number;
  tenure: number;
  intrest_rate: number;
  emi_amount: number;
  emi_start_month: string;
  emi_end_month: string;
  remarks: string | null;
  is_completed: string;
  created_date: string;
  paid: number;
  balance_amount: number;
  completion_pct: number;
  schedule: LoanScheduleRow[];
}

// Mirrors EmployeeLoanController::viewloan() + viewloan.ctp's display logic (NOT its
// writes-on-read column "normalisation", which is legacy cruft). Running balance: opening starts at
// loan_amount, closing = opening − amount_paid, carry closing into the next opening. Rows whose EMI
// was zeroed by an additional payment or a transfer (loan_emi = 0 AND paid_status IN ('A','P')) are
// hidden and don't advance the serial number, exactly as the .ctp does.
export async function getLoanDetail(pool: Pool, loanPkey: number): Promise<LoanDetail | null> {
  const [[master]] = await pool.execute<RowDataPacket[]>(
    `SELECT au.emp_loan_pkey, au.emp_fkey, au.loan_amount, au.tenure, au.intrest_rate, au.emi_amount,
            au.emi_start_month, au.emi_end_month, au.remarks, au.is_completed, au.created_date,
            CONCAT(COALESCE(ed.first_name,''),' ',COALESCE(ed.last_name,'')) AS emp_name,
            ep.emp_company_id
     FROM emp_loan au
     JOIN emp_details ed ON ed.emp_pkey = au.emp_fkey
     LEFT JOIN emp_proff ep ON ep.emp_fkey = au.emp_fkey
     WHERE au.emp_loan_pkey = ? AND au.status = 1`,
    [loanPkey]
  );
  if (!master) return null;

  const [infoRows] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_loan_info_pkey, loan_month, loan_emi, amount_paid, paid_status, emi_transfer,
            remarks, user_remarks
     FROM emp_loan_info
     WHERE loan_pkey = ? AND status = 1
     ORDER BY loan_month`,
    [loanPkey]
  );

  const loanAmount = Number(master.loan_amount);
  let openingBalance = loanAmount;
  let slNo = 0;
  const schedule: LoanScheduleRow[] = [];

  for (const row of infoRows) {
    const emi = Number(row.loan_emi ?? 0);
    const amountPaid = Number(row.amount_paid ?? 0);
    const closingBalance = openingBalance - amountPaid;
    const paidStatus = String(row.paid_status ?? '');

    const hidden = emi === 0 && (paidStatus === 'A' || paidStatus === 'P');
    if (!hidden) {
      slNo += 1;
      schedule.push({
        emp_loan_info_pkey: Number(row.emp_loan_info_pkey),
        sl_no: slNo,
        loan_month: String(row.loan_month ?? '').slice(0, 7),
        opening_balance: Math.round(openingBalance),
        loan_emi: Math.round(emi),
        amount_paid: Math.round(amountPaid),
        closing_balance: closingBalance <= 0 ? 0 : Math.round(closingBalance),
        monthly_status: String(row.remarks ?? ''),
        user_remarks: String(row.user_remarks ?? ''),
        paid_status: paidStatus,
        emi_transfer: String(row.emi_transfer ?? ''),
      });
    }
    openingBalance = closingBalance;
  }

  const paid = infoRows.reduce((sum, r) => sum + Number(r.amount_paid ?? 0), 0);
  const rawBalance = loanAmount - paid;
  const balanceAmount = rawBalance <= 12 ? 0 : Math.round(rawBalance);
  let completionPct = loanAmount !== 0 ? Math.ceil((paid / loanAmount) * 100) : 0;
  if (completionPct > 100 || rawBalance <= 12) completionPct = 100;

  return {
    emp_loan_pkey: Number(master.emp_loan_pkey),
    emp_fkey: Number(master.emp_fkey),
    emp_name: String(master.emp_name ?? '').trim(),
    emp_company_id: master.emp_company_id ?? null,
    loan_amount: loanAmount,
    tenure: Number(master.tenure),
    intrest_rate: Number(master.intrest_rate ?? 0),
    emi_amount: Math.round(Number(master.emi_amount ?? 0)),
    emi_start_month: String(master.emi_start_month ?? '').slice(0, 7),
    emi_end_month: String(master.emi_end_month ?? '').slice(0, 7),
    remarks: master.remarks ?? null,
    is_completed: String(master.is_completed ?? 'N'),
    created_date: master.created_date instanceof Date
      ? master.created_date.toISOString()
      : String(master.created_date ?? ''),
    paid: Math.round(paid),
    balance_amount: balanceAmount,
    completion_pct: completionPct,
    schedule,
  };
}

// Mirrors EmployeeLoanController::amount_pay()'s core mechanic (a lump-sum payment applied
// against future EMI rows starting from the latest scheduled month backward, fully absorbing a
// month's EMI if the payment covers it or partially reducing the last month it touches) — but
// deviates from legacy in one deliberate way: legacy's own insert leaves the payment row's
// `amount_paid` empty, so its own completion check (SUM(amount_paid) vs loan_amount) can never
// actually see a lump-sum payoff — a real gap in legacy's own bookkeeping, not a business rule
// worth replicating. Here the payment row records its own amount_paid so completion detection
// (comparing total amount_to_paid vs total amount_paid across the schedule) works correctly.
//
// Guards ported from amount_pay() (all raise LoanValidationError with legacy's exact message):
//   1. payroll already processed for the current month for this employee (hard block, unlike advances);
//   2. this month's EMI on this loan is already settled (paid_status='P', not a transfer);
//   3. the payment would exceed the remaining balance after this month's scheduled EMI.
export async function payLoanAmount(
  pool: Pool,
  loanPkey: number,
  amount: number,
  userId: string,
  userRemarks = ''
) {
  const [[loan]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_fkey, loan_amount FROM emp_loan WHERE emp_loan_pkey = ?', [loanPkey]
  );
  if (!loan) throw new Error('Loan not found');

  const today = new Date().toISOString().slice(0, 7);

  if (await isPayrollAlreadyProcessed(pool, Number(loan.emp_fkey), today)) {
    throw new LoanValidationError('Payroll Already Processed');
  }

  const [[processedRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM emp_loan_info
     WHERE emp_fkey = ? AND loan_pkey = ? AND loan_month = ? AND paid_status = 'P'
       AND status = 1 AND emi_transfer != 'Y'`,
    [loan.emp_fkey, loanPkey, today]
  );
  if (Number(processedRow?.cnt ?? 0) > 0) {
    throw new LoanValidationError('Loan Already Processed');
  }

  const [[balanceRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT
       COALESCE((SELECT SUM(amount_paid) FROM emp_loan_info WHERE loan_pkey = ? AND emp_fkey = ? AND status = 1), 0) AS paid,
       COALESCE((SELECT SUM(loan_emi) FROM emp_loan_info WHERE loan_pkey = ? AND emp_fkey = ? AND loan_month = ? AND status = 1), 0) AS emi_this_month`,
    [loanPkey, loan.emp_fkey, loanPkey, loan.emp_fkey, today]
  );
  const remainingAfterThisMonth =
    Number(loan.loan_amount) - (Number(balanceRow?.paid ?? 0) + Number(balanceRow?.emi_this_month ?? 0));
  if (remainingAfterThisMonth < amount) {
    throw new LoanValidationError('Total Additional Payment exceed Balance Amount');
  }

  await pool.execute(
    `INSERT INTO emp_loan_info
       (emp_fkey, loan_type, loan_pkey, loan_month, loan_tenure, principle, interest, amount_to_paid,
        amount_paid, loan_emi, closing_balance, opening_balance, paid_status, created_by, remarks, user_remarks)
     VALUES (?, 'Loan', ?, ?, 0, 0, 0, ?, ?, 0, 0, 0, 'S', ?, ?, ?)`,
    [
      loan.emp_fkey, loanPkey, today, amount, amount, userId,
      `Additional Payment for the month ${today} of Rs.${amount}`, userRemarks,
    ]
  );

  // Only pre-generated, not-yet-consumed schedule rows (paid_status='A') — this naturally
  // excludes the payment row itself (paid_status='S'), unlike a bare "not yet fully paid" filter.
  const [scheduleRows] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_loan_info_pkey, loan_month, loan_emi FROM emp_loan_info
     WHERE loan_pkey = ? AND paid_status = 'A' AND emi_transfer != 'Y' AND loan_emi != 0 AND status = 1
     ORDER BY loan_month DESC`,
    [loanPkey]
  );

  let balance = amount;
  for (const row of scheduleRows) {
    if (balance <= 0) break;
    const emi = Number(row.loan_emi);
    if (balance >= emi) {
      balance -= emi;
      await pool.execute(
        `UPDATE emp_loan_info SET principle=0, interest=0, amount_to_paid=0, loan_emi=0,
                closing_balance=0, opening_balance=0, remarks = ?
         WHERE emp_loan_info_pkey = ?`,
        [`Loan amount already paid on ${today}`, row.emp_loan_info_pkey]
      );
    } else {
      const finalBalance = emi - balance;
      await pool.execute(
        `UPDATE emp_loan_info SET amount_to_paid = ?, loan_emi = ?, remarks = ? WHERE emp_loan_info_pkey = ?`,
        [finalBalance, finalBalance, `EMI for the month Rs.${finalBalance}`, row.emp_loan_info_pkey]
      );
      balance = 0;
    }
  }

  const [[totals]] = await pool.execute<RowDataPacket[]>(
    `SELECT SUM(amount_to_paid) AS due, SUM(amount_paid) AS paid FROM emp_loan_info WHERE loan_pkey = ? AND status = 1`,
    [loanPkey]
  );
  if (Number(totals?.due ?? 0) - Number(totals?.paid ?? 0) <= 0) {
    await pool.execute(`UPDATE emp_loan SET is_completed = 'Y' WHERE emp_loan_pkey = ?`, [loanPkey]);
    await pool.execute(`UPDATE emp_loan_info SET paid_status = 'P' WHERE loan_pkey = ? AND status = 1`, [loanPkey]);
  }
}

// Mirrors EmployeeLoanController::completed() — force-mark a loan fully paid/closed. Legacy also
// settles every schedule row's amount_paid to its loan_emi so the SUM(amount_paid)-based "paid" /
// "balance" / "completion %" figures on the ledger and the Loan Report reconcile to a closed loan.
export async function markLoanCompleted(pool: Pool, loanPkey: number) {
  await pool.execute(
    `UPDATE emp_loan SET is_completed = 'Y' WHERE emp_loan_pkey = ? AND status = 1`,
    [loanPkey]
  );
  await pool.execute(
    `UPDATE emp_loan_info SET amount_paid = loan_emi, paid_status = 'P' WHERE loan_pkey = ? AND status = 1`,
    [loanPkey]
  );
}

// ── Loan Requests (employee "My Request" + admin approval) ─────────────────────────────────────
// A new, separate table from `emp_loan`/`emp_loan_info` — both are live tables read by payroll
// deduction and the Loan Report, so an unapproved employee request must never land there. An
// `emp_loan` row (plus its full EMI schedule) is only created, via createLoan() above, once a
// request is approved. Mirrors emp_advance_request's design 1:1.

export interface LoanRequestInput {
  empFkey: number;
  loanAmount: number;
  tenure: number;
  interestRate: number;
  emiStartMonth: string; // 'YYYY-MM'
  remarks?: string;
}

export async function createLoanRequest(pool: Pool, input: LoanRequestInput, userId: string): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO emp_loan_request
       (emp_fkey, loan_amount, tenure, intrest_rate, emi_start_month, remarks, request_status, created_by, modified_by, modified_date, status)
     VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?, ?, NOW(), 1)`,
    [input.empFkey, input.loanAmount, input.tenure, input.interestRate, input.emiStartMonth, input.remarks ?? '', userId, userId]
  );
  return result.insertId;
}

export interface LoanRequestListParams {
  empFkey?: number;
  requestStatus?: 'Pending' | 'Approved' | 'Rejected';
  month?: string; // 'YYYY-MM'
}

export async function listLoanRequests(pool: Pool, params: LoanRequestListParams) {
  const conditions: string[] = ['lr.status = 1'];
  const args: (string | number)[] = [];
  if (params.empFkey) { conditions.push('lr.emp_fkey = ?'); args.push(params.empFkey); }
  if (params.requestStatus) { conditions.push('lr.request_status = ?'); args.push(params.requestStatus); }
  if (params.month) { conditions.push('lr.emi_start_month = ?'); args.push(params.month); }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT lr.emp_loan_request_pkey, lr.emp_fkey, lr.loan_amount, lr.tenure, lr.intrest_rate,
            lr.emi_start_month, lr.remarks, lr.request_status, lr.admin_remarks, lr.linked_loan_pkey,
            lr.reviewed_by, lr.reviewed_date, lr.created_date,
            CONCAT(COALESCE(ed.first_name,''),' ',COALESCE(ed.last_name,'')) AS emp_name
     FROM emp_loan_request lr
     JOIN emp_details ed ON ed.emp_pkey = lr.emp_fkey
     WHERE ${conditions.join(' AND ')}
     ORDER BY lr.created_date DESC`,
    args
  );
  return rows;
}

// Approving a request runs the exact same EMI-generation sequence as the admin's direct "New Loan"
// flow (createLoan), then marks the request Approved and links it to the new emp_loan row — all in
// one transaction (createLoan() itself issues multiple inserts) so a request is never left
// half-approved with a partial EMI schedule.
export async function approveLoanRequest(pool: Pool, requestId: number, userId: string): Promise<{ loanId: number }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[reqRow]] = await conn.execute<RowDataPacket[]>(
      'SELECT emp_loan_request_pkey, emp_fkey, loan_amount, tenure, intrest_rate, emi_start_month, remarks, request_status FROM emp_loan_request WHERE emp_loan_request_pkey = ? AND status = 1 FOR UPDATE',
      [requestId]
    );
    if (!reqRow) throw new Error('NOT_FOUND');
    if (reqRow.request_status !== 'Pending') throw new Error('NOT_PENDING');

    const loanId = await createLoan(conn, {
      empFkey: reqRow.emp_fkey,
      loanAmount: Number(reqRow.loan_amount),
      tenure: Number(reqRow.tenure),
      interestRate: Number(reqRow.intrest_rate),
      emiStartMonth: reqRow.emi_start_month,
      remarks: reqRow.remarks ?? undefined,
    }, userId);

    await conn.execute(
      `UPDATE emp_loan_request
       SET request_status = 'Approved', linked_loan_pkey = ?, reviewed_by = ?, reviewed_date = NOW(), modified_by = ?, modified_date = NOW()
       WHERE emp_loan_request_pkey = ?`,
      [loanId, userId, userId, requestId]
    );

    await conn.commit();
    return { loanId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function rejectLoanRequest(pool: Pool, requestId: number, userId: string, adminRemarks?: string): Promise<void> {
  const [[reqRow]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_loan_request_pkey, request_status FROM emp_loan_request WHERE emp_loan_request_pkey = ? AND status = 1',
    [requestId]
  );
  if (!reqRow) throw new Error('NOT_FOUND');
  if (reqRow.request_status !== 'Pending') throw new Error('NOT_PENDING');

  await pool.execute(
    `UPDATE emp_loan_request
     SET request_status = 'Rejected', admin_remarks = ?, reviewed_by = ?, reviewed_date = NOW(), modified_by = ?, modified_date = NOW()
     WHERE emp_loan_request_pkey = ?`,
    [adminRemarks ?? null, userId, userId, requestId]
  );
}
