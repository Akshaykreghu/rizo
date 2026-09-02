import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getOpenFinYear } from '@/lib/taxation';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports the read-only "tax projection worksheet" half of legacy TaxController::setup() — the part
// beyond the declare/lock/upload workflow: month-wise TDS deducted + gross paid, projected vs
// actual vs taxable salary for the FY, the exempt-allowance breakdown, and the New-regime slab
// table. All figures come from data the payroll run + tax_salary_distribution_fn already produced
// (emp_salary_slip, emp_tax_sal_trans, income_tax_slab); this route only reads and groups them.
// Each block is guarded so a tenant missing one of the optional tables still returns the rest.

function fyMonths(startMonth: string, endMonth: string, joiningDate: string | null): string[] {
  // legacy firstDayOfMonth loop: FY window, but not earlier than the employee's joining month.
  const start = new Date(startMonth);
  const joined = joiningDate ? new Date(joiningDate) : null;
  const from = joined && joined > start ? joined : start;
  const end = new Date(endMonth);
  const months: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor <= end) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function firstRow(pool: Awaited<ReturnType<typeof getCompanyPool>>, sql: string, args: (string | number)[]): Promise<RowDataPacket | null> {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(sql, args);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const empFkey = Number(id);
  const pool = await getCompanyPool(session.user.companyCode);

  const [[emp]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_branch FROM emp_proff WHERE emp_fkey = ?',
    [id]
  );
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const finYear = await getOpenFinYear(pool, emp.emp_branch);
  if (!finYear) return NextResponse.json({ noFinYear: true });

  const fy = String(finYear.finYear);

  const joinInfo = await firstRow(pool, 'SELECT joining_date FROM employee_info WHERE emp_pkey = ?', [empFkey]);
  const joiningDate: string | null = joinInfo?.joining_date ? String(joinInfo.joining_date).slice(0, 10) : null;

  const months = fyMonths(finYear.startMonth, finYear.endMonth, joiningDate);

  // Month-wise TDS deducted + gross paid, from processed/approved payroll only (legacy's exact filter).
  const monthly = await safe(async () => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT s.month_year,
              SUM(CASE WHEN UCASE(s.salary_head_item_desc) = 'TDS' THEN ABS(ROUND(s.salary_amount)) ELSE 0 END) AS tds,
              SUM(CASE WHEN s.head_operator <> 'Deduction' AND s.item_part <> 'Indirect'
                        AND UCASE(s.salary_head_item_desc) NOT IN ('SALARY ADVANCE','LOANS','TDS')
                       THEN ABS(ROUND(s.salary_amount)) ELSE 0 END) AS gross
       FROM emp_salary_slip s
       WHERE s.emp_fkey = ? AND s.end_date_effective IS NULL
         AND s.month_year BETWEEN ? AND ?
         AND s.payroll_master_fkey IN (SELECT payroll_master_pkey FROM payroll_master WHERE action IN ('Processed','Approved'))
       GROUP BY s.month_year`,
      [empFkey, months[0] ?? `${fy}-04`, months[months.length - 1] ?? `${fy}-03`]
    );
    const byMonth = new Map(rows.map((r) => [String(r.month_year), r]));
    return months.map((m) => ({
      month: m,
      tds: Number(byMonth.get(m)?.tds ?? 0),
      gross: Number(byMonth.get(m)?.gross ?? 0),
    }));
  }, months.map((m) => ({ month: m, tds: 0, gross: 0 })));

  // Projected / actual / taxable salary totals for the FY.
  const totals = await firstRow(
    pool,
    `SELECT COALESCE(SUM(projected_salary), 0) AS projected,
            COALESCE(SUM(actual_salary_recd), 0) AS actual,
            COALESCE(SUM(taxable_salary), 0) AS taxable
     FROM emp_tax_sal_trans
     WHERE emp_fkey = ? AND fin_year = ? AND end_date_effective IS NULL AND status = 1`,
    [empFkey, fy]
  );

  // Exempt-allowance breakdown (legacy $taxcomponents).
  const components = await safe(async () => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT TSC.tax_salary_components_name AS name, SHI.item AS item,
              t.availed_salary, t.upper_limit, t.taxable_salary
       FROM emp_tax_sal_trans t
       LEFT JOIN tax_salary_components TSC ON t.tax_salary_components_fkey = TSC.tax_salary_components_pkey
       LEFT JOIN salary_head_items SHI ON t.salary_head_item_Fkey = SHI.salary_head_item_pkey
       WHERE t.emp_fkey = ? AND t.end_date_effective IS NULL AND t.fin_year = ?`,
      [empFkey, fy]
    );
    return rows.map((r) => ({
      name: r.name ?? r.item ?? '—',
      availed: Number(r.availed_salary ?? 0),
      upperLimit: Number(r.upper_limit ?? 0),
      taxable: Number(r.taxable_salary ?? 0),
    }));
  }, [] as { name: string; availed: number; upperLimit: number; taxable: number }[]);

  // New-regime slab table for the FY (legacy renders this on the setup screen).
  const slabs = await safe(async () => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT salary_range_from, salary_range_to, tax_yearly_perc, std_deduction, rebate, cess_perc
       FROM income_tax_slab
       WHERE fin_year = ? AND regime = 'NEW' AND salary_range_to <= 50000000
       ORDER BY salary_range_from`,
      [fy]
    );
    return rows.map((r) => ({
      from: Number(r.salary_range_from),
      to: Number(r.salary_range_to),
      percent: Number(r.tax_yearly_perc ?? 0),
      stdDeduction: Number(r.std_deduction ?? 0),
      rebate: Number(r.rebate ?? 0),
      cessPercent: Number(r.cess_perc ?? 0),
    }));
  }, [] as { from: number; to: number; percent: number; stdDeduction: number; rebate: number; cessPercent: number }[]);

  const hasPayroll = monthly.some((m) => m.tds > 0 || m.gross > 0) || Number(totals?.actual ?? 0) > 0;

  return NextResponse.json({
    finYear: finYear.finYear,
    hasPayroll,
    monthly,
    totals: {
      projected: Number(totals?.projected ?? 0),
      actual: Number(totals?.actual ?? 0),
      taxable: Number(totals?.taxable ?? 0),
    },
    components,
    slabs,
  });
}
