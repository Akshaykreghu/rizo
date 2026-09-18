import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getOpenFinYear } from '@/lib/taxation';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Self-service payroll history for the ESS "My Salary" page — payroll_master is otherwise only
// exposed via GET /api/payroll, an admin-only branch-wide processing list (wrong shape and scope
// for "my own pay history"). Financial-year resolution reuses getOpenFinYear, the same source of
// truth the tax-* routes already use, so "current FY" means the same thing everywhere.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const empPkey = parseInt(id);
  if (session.user.userGroup !== 1 && session.user.empFkey !== empPkey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const { searchParams } = new URL(request.url);
  const requestedFinYear = searchParams.get('fin_year_id');

  const [[emp]] = await pool.execute<RowDataPacket[]>(
    `SELECT e.emp_pkey, e.first_name, e.last_name, e.emp_id, p.emp_branch, p.joining_date,
            ds.desig_name, d.dept_name
     FROM emp_details e
     LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
     LEFT JOIN designation ds ON ds.desig_code = p.designation
     LEFT JOIN department d ON d.dept_code = p.emp_dept
     WHERE e.emp_pkey = ?`,
    [empPkey]
  );
  if (!emp) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [[ctc]] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_anual_ctc, emp_monthly_ctc FROM emp_ctc_upload
     WHERE emp_fkey = ? AND status = 1 ORDER BY emp_ctc_upload_pkey DESC LIMIT 1`,
    [empPkey]
  );
  const monthlyCtc = ctc?.emp_monthly_ctc ? Number(ctc.emp_monthly_ctc) : Math.round(Number(ctc?.emp_anual_ctc ?? 0) / 12);

  const [finYearRows] = await pool.execute<RowDataPacket[]>(
    `SELECT DISTINCT Fin_year_seq AS id, fin_year, start_month, end_month
     FROM fin_year WHERE branch_code = ? AND status = 1
     ORDER BY start_month DESC LIMIT 6`,
    [emp.emp_branch]
  );

  interface FinYearRow { id: number; fin_year: number; start_month: string; end_month: string }
  let finYear: FinYearRow | undefined = requestedFinYear
    ? finYearRows.find((f) => String(f.id) === requestedFinYear) as FinYearRow | undefined
    : undefined;
  if (!finYear) {
    const open = await getOpenFinYear(pool, emp.emp_branch);
    finYear = open
      ? (finYearRows.find((f) => f.fin_year === open.finYear) as FinYearRow | undefined) ??
        { id: open.finYearSeq, fin_year: open.finYear, start_month: String(open.startMonth), end_month: String(open.endMonth) }
      : (finYearRows[0] as FinYearRow | undefined);
  }
  if (!finYear) return NextResponse.json({ employee: emp, finYear: null, allFinYears: [], months: [], allFYMonths: [] });

  const allFYMonths: string[] = [];
  const cur = new Date(finYear.start_month);
  const end = new Date(finYear.end_month);
  while (cur <= end) {
    allFYMonths.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
    cur.setMonth(cur.getMonth() + 1);
  }

  const [payrollRows] = await pool.execute<RowDataPacket[]>(
    `SELECT payroll_master_pkey, month_year, gross_salary, net_salary, total_deduction, days_presant, action
     FROM payroll_master
     WHERE emp_fkey = ? AND month_year IN (${allFYMonths.map(() => '?').join(',')})
     ORDER BY month_year ASC`,
    [empPkey, ...allFYMonths]
  );

  const months = payrollRows
    .filter((r) => r.action === 'Processed' || r.action === 'Approved' || r.action === 'Verified')
    .map((r) => ({
      month: r.month_year, payroll_master_id: r.payroll_master_pkey,
      gross_salary: Number(r.gross_salary ?? 0), net_salary: Number(r.net_salary ?? 0),
      total_deductions: Number(r.total_deduction ?? 0), present_days: Number(r.days_presant ?? 0),
    }));

  let latestLines: unknown[] = [];
  const latest = months[months.length - 1];
  if (latest) {
    const [lines] = await pool.execute<RowDataPacket[]>(
      `SELECT ess.head_operator, ess.salary_head_item_desc AS item_name, ess.salary_amount AS amount
       FROM emp_salary_slip ess
       WHERE ess.payroll_master_fkey = ? AND ess.end_date_effective IS NULL AND ess.item_part != 'Indirect'`,
      [latest.payroll_master_id]
    );
    latestLines = lines.map((l) => ({ head_type: l.head_operator, item_name: l.item_name, amount: Number(l.amount ?? 0) }));
  }

  return NextResponse.json({
    employee: { ...emp, gross_ctc: monthlyCtc },
    finYear: { id: finYear.id, fin_year: `FY ${finYear.fin_year}-${String(finYear.fin_year + 1).slice(-2)}` },
    allFinYears: finYearRows.map((f) => ({ id: f.id, fin_year: `FY ${f.fin_year}-${String(f.fin_year + 1).slice(-2)}` })),
    months,
    allFYMonths,
    latestLines,
  });
}
