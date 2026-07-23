import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

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
export async function createLoan(pool: Pool, input: LoanInput, userId: string): Promise<number> {
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

// Mirrors EmployeeLoanController::amount_pay()'s core mechanic (a lump-sum payment applied
// against future EMI rows starting from the latest scheduled month backward, fully absorbing a
// month's EMI if the payment covers it or partially reducing the last month it touches) — but
// deviates from legacy in one deliberate way: legacy's own insert leaves the payment row's
// `amount_paid` empty, so its own completion check (SUM(amount_paid) vs loan_amount) can never
// actually see a lump-sum payoff — a real gap in legacy's own bookkeeping, not a business rule
// worth replicating. Here the payment row records its own amount_paid so completion detection
// (comparing total amount_to_paid vs total amount_paid across the schedule) works correctly.
export async function payLoanAmount(pool: Pool, loanPkey: number, amount: number, userId: string) {
  const [[loan]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_fkey FROM emp_loan WHERE emp_loan_pkey = ?', [loanPkey]
  );
  if (!loan) throw new Error('Loan not found');

  const today = new Date().toISOString().slice(0, 7);
  await pool.execute(
    `INSERT INTO emp_loan_info
       (emp_fkey, loan_type, loan_pkey, loan_month, loan_tenure, principle, interest, amount_to_paid,
        amount_paid, loan_emi, closing_balance, opening_balance, paid_status, created_by, remarks)
     VALUES (?, 'Loan', ?, ?, 0, 0, 0, ?, ?, 0, 0, 0, 'S', ?, ?)`,
    [loan.emp_fkey, loanPkey, today, amount, amount, userId, `Additional Payment for the month ${today} of Rs.${amount}`]
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

// Mirrors EmployeeLoanController::completed() — force-mark a loan fully paid/closed.
export async function markLoanCompleted(pool: Pool, loanPkey: number) {
  await pool.execute(`UPDATE emp_loan SET is_completed = 'Y' WHERE emp_loan_pkey = ?`, [loanPkey]);
  await pool.execute(`UPDATE emp_loan_info SET paid_status = 'P' WHERE loan_pkey = ?`, [loanPkey]);
}
