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

  // emp_ctc_transaction (not emp_ctc_upload, an insert log of every upload event) is the
  // employee's current CTC record everywhere else in this codebase — advances.ts, increments.ts,
  // bulk-policies/salary and variable-upload/template all key off end_date_effective IS NULL the
  // same way. It has no emp_monthly_ctc column at all (only emp_anual_ctc), so monthly is always
  // derived by /12 here — there's no separate stored monthly figure to prefer.
  const [[ctc]] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_anual_ctc FROM emp_ctc_transaction WHERE emp_fkey = ? AND end_date_effective IS NULL`,
    [empPkey]
  );
  const monthlyCtc = Math.round(Number(ctc?.emp_anual_ctc ?? 0) / 12);

  // Total earned at this company — every approved month ever processed for this employee here,
  // not scoped to any one financial year (so it doesn't reset when switching FY below) and, since
  // getCompanyPool already scopes every query in this route to the employee's own company DB,
  // naturally excludes any other employer's payroll history too.
  const [[lifetimeRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS months_count, MIN(month_year) AS first_month,
            SUM(gross_salary) AS gross_total, SUM(net_salary) AS net_total, SUM(total_deduction) AS deductions_total
     FROM payroll_master WHERE emp_fkey = ? AND action = 'Approved'`,
    [empPkey]
  );
  const lifetime = {
    monthsProcessed: Number(lifetimeRow?.months_count ?? 0),
    firstMonth: lifetimeRow?.first_month ?? null,
    grossTotal: Number(lifetimeRow?.gross_total ?? 0),
    netTotal: Number(lifetimeRow?.net_total ?? 0),
    deductionsTotal: Number(lifetimeRow?.deductions_total ?? 0),
  };

  // PF (EPF) contribution history, month by month — a passbook-style ledger, like the EPFO member
  // portal, with the employee's own contribution and the employer's kept separate (they're
  // different pots — the employer side isn't part of the employee's take-home or their own
  // deduction, so folding them into one figure would misrepresent both). tax_salary_components maps
  // each fixed component name ("Employee EPF" / "Employer EPF") to whichever salary_head_item_fkey
  // a company's own salary structure actually uses for it (this isn't hardcoded to a specific id,
  // since that varies per company/structure) — same lookup pattern the user's own reference query
  // used. end_date_effective IS NULL picks only the current (non-superseded) line per month — a
  // corrected payslip leaves its old line behind with that column set instead of deleting it — and
  // the payroll_master join restricts this to the same 'Approved' months every other total on this
  // page is scoped to.
  const [pfRows] = await pool.execute<RowDataPacket[]>(
    `SELECT ess.month_year, tsc.tax_salary_components_name AS component, SUM(ABS(ess.salary_amount)) AS amount
     FROM emp_salary_slip ess
     JOIN payroll_master pm ON pm.payroll_master_pkey = ess.payroll_master_fkey
     JOIN tax_salary_components tsc ON tsc.salary_head_item_Fkey = ess.salary_head_item_fkey AND tsc.status = 1
     WHERE ess.emp_fkey = ? AND ess.end_date_effective IS NULL AND pm.action = 'Approved'
       AND tsc.tax_salary_components_name IN ('Employee EPF', 'Employer EPF')
     GROUP BY ess.month_year, tsc.tax_salary_components_name
     ORDER BY ess.month_year DESC`,
    [empPkey]
  );
  const pfByMonth = new Map<string, { month: string; employee: number; employer: number }>();
  for (const r of pfRows) {
    const row = pfByMonth.get(r.month_year) ?? { month: r.month_year as string, employee: 0, employer: 0 };
    if (r.component === 'Employee EPF') row.employee = Number(r.amount ?? 0);
    else row.employer = Number(r.amount ?? 0);
    pfByMonth.set(r.month_year, row);
  }
  const pfMonths = [...pfByMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
  const pf = {
    months: pfMonths,
    employeeTotal: pfMonths.reduce((s, m) => s + m.employee, 0),
    employerTotal: pfMonths.reduce((s, m) => s + m.employer, 0),
    firstMonth: pfMonths.length ? pfMonths[pfMonths.length - 1].month : null,
  };

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
  if (!finYear) return NextResponse.json({ employee: emp, finYear: null, allFinYears: [], months: [], allFYMonths: [], lifetime, pf });

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

  // Only 'Approved' counts as visible to the employee — 'Processed'/'Verified' are earlier,
  // still-editable stages of the same admin workflow (see /api/payroll/route.ts's own
  // processed vs. approved split and /api/payroll/approve/route.ts, which is the only thing
  // that ever sets action='Approved'); legacy's own salary-total queries filter the same way.
  const months = payrollRows
    .filter((r) => r.action === 'Approved')
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
    lifetime,
    pf,
  });
}
