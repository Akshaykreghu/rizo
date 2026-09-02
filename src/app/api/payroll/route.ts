import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { seedPayrollDraft } from '@/lib/payroll';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

const ACTION_BY_STATUS: Record<string, string> = {
  pending: `(pm.action IS NULL OR pm.action = '')`,
  hold: `pm.action = 'Hold'`,
  // Mirrors PayrollController::listprocessedpayroll()'s "Processed" tab on the Process Payroll
  // screen: everything that has left Not Processed (Hold/Processed/Verified/Approved together),
  // not just the Approve-screen's "Processed"/"Verified" subset below.
  not_pending: `(pm.action IS NOT NULL AND pm.action <> '')`,
  processed: `pm.action IN ('Processed', 'Verified')`,
  approved: `pm.action = 'Approved'`,
};

const PREV_SALARY_STATUSES = new Set(['not_pending', 'processed']);

function shiftMonthYear(monthYear: string, deltaMonths: number): string {
  const [y, m] = monthYear.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Mirrors PayrollController::listpayroll()/listapprovepayroll()/listapprovedpayroll() — same shape,
// same emp_details/termination joins for the "resigned" warning flag, same attendance-reversal
// exclusion (emp_fkey excluded if attendance_register.isdelete='Y' for that branch/month) confirmed
// live only applies to the pending tab (that's what legacy's listpayroll() does; the approve-stage
// listings don't re-check attendance reversal).
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const branch = request.nextUrl.searchParams.get('branch') ?? '';
  const month = request.nextUrl.searchParams.get('month') ?? '';
  const status = request.nextUrl.searchParams.get('status') ?? 'pending';
  const employee = request.nextUrl.searchParams.get('employee') ?? '';
  if (!branch || !month) return NextResponse.json({ error: 'branch and month are required' }, { status: 400 });

  const actionClause = ACTION_BY_STATUS[status] ?? ACTION_BY_STATUS.pending;
  const pool = await getCompanyPool(session.user.companyCode);

  const params: (string | number)[] = [branch, month];
  let attendanceExclusion = '';
  if (status === 'pending') {
    attendanceExclusion = `AND pm.emp_fkey NOT IN (
      SELECT emp_fkey FROM attendance_register WHERE month_year = ? AND isdelete = 'Y' AND branch_code = ?
    )`;
    params.push(month, branch);
  }
  let employeeClause = '';
  if (employee) {
    employeeClause = 'AND pm.emp_fkey = ?';
    params.push(employee);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT pm.payroll_master_pkey, pm.emp_fkey, pm.emp_name, pm.days_presant, pm.days_leave,
            pm.loss_of_pay, pm.monthly_ctc, pm.monthly_amount, pm.calander_days, pm.working_days,
            pm.gross_salary, pm.net_salary, pm.total_deduction, pm.action, pm.tax_include,
            ed.status AS emp_status, t.submitted_date
     FROM payroll_master pm
     LEFT JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
     LEFT JOIN termination t ON t.emp_fkey = pm.emp_fkey AND t.status = 1
     WHERE ${actionClause} AND pm.branch_code = ? AND pm.month_year = ? ${attendanceExclusion} ${employeeClause}
     ORDER BY pm.emp_name ASC`,
    params
  );

  // Mirrors PayrollController's Previous Salary / Difference columns (listprocessedpayroll /
  // listapprovepayroll): looked up from the prior month's payroll_master row per employee, only
  // computed for the tabs that show it.
  let prevNetByEmp = new Map<number, number>();
  if (PREV_SALARY_STATUSES.has(status)) {
    const prevMonth = shiftMonthYear(month, -1);
    const prevParams: (string | number)[] = [branch, prevMonth];
    let prevEmployeeClause = '';
    if (employee) {
      prevEmployeeClause = 'AND emp_fkey = ?';
      prevParams.push(employee);
    }
    const [prevRows] = await pool.execute<RowDataPacket[]>(
      `SELECT emp_fkey, net_salary FROM payroll_master
       WHERE branch_code = ? AND month_year = ? ${prevEmployeeClause}`,
      prevParams
    );
    prevNetByEmp = new Map(prevRows.map((r) => [r.emp_fkey, Number(r.net_salary)]));
  }

  const result = rows.map((r) => {
    const netSalary = r.net_salary != null ? Math.round(Number(r.net_salary)) : null;
    const prevNet = prevNetByEmp.get(r.emp_fkey);
    return {
      payroll_master_pkey: r.payroll_master_pkey,
      emp_fkey: r.emp_fkey,
      emp_name: r.emp_name,
      days_presant: r.days_presant,
      days_leave: r.days_leave,
      loss_of_pay: r.loss_of_pay,
      monthly_ctc: r.monthly_ctc,
      monthly_amount: r.monthly_amount != null ? Math.round(Number(r.monthly_amount)) : null,
      calander_days: r.calander_days,
      working_days: r.working_days,
      gross_salary: r.gross_salary,
      net_salary: netSalary,
      total_deductions: r.total_deduction,
      action: r.action,
      tax_include: r.tax_include,
      resigned: r.emp_status === 2 || !!r.submitted_date,
      last_month_net_salary: prevNet != null ? Math.round(prevNet) : null,
      diff: prevNet != null && netSalary != null ? netSalary - Math.round(prevNet) : null,
    };
  });

  return NextResponse.json({ rows: result });
}

// Mirrors PayrollController's seed step (payroll_master_insert) triggered when HR picks branch+month.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as { branch: string; month: string };
  if (!body.branch || !body.month) {
    return NextResponse.json({ error: 'branch and month are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  console.log('seedPayrollDraft params: ' + JSON.stringify({
    branch: body.branch,
    monthYear: body.month,
    userId: session.user.loginUserId,
  }));
  const err = await seedPayrollDraft(pool, body.branch, body.month, session.user.loginUserId);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  return NextResponse.json({ success: true });
}
