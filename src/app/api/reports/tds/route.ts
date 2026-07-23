import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors TaxReportController::generatesummaryreport() — a TDS report sourced from the tax
// distribution summary tables, filtered by the month a summary row started being effective
// (start_date_effective), optionally scoped to a branch. Legacy's version only reads
// emp_tax_sal_trans_sum (old regime) — a real gap, since employees on the new regime never
// appear. This report reads both summary tables and tags each row with its regime, which is
// more complete than legacy without changing any payroll/tax computation behavior (report-only).
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const branch = request.nextUrl.searchParams.get('branch') ?? '';
  const month = request.nextUrl.searchParams.get('month') ?? '';
  if (!month) return NextResponse.json({ error: 'month is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const branchClause = branch ? 'AND p.emp_branch = ?' : '';
  const branchParam = branch ? [branch] : [];

  const [oldRows] = await pool.execute<RowDataPacket[]>(
    `SELECT s.emp_fkey, d.first_name, d.last_name, p.emp_branch, s.taxable_income,
            s.tax_yearly, s.tax_monthly_proj, s.surcharge, s.cess, s.rebate, s.fin_year,
            'Old' AS regime
     FROM emp_tax_sal_trans_sum s
     JOIN emp_details d ON d.emp_pkey = s.emp_fkey
     JOIN emp_proff p ON p.emp_fkey = s.emp_fkey
     WHERE s.status = 1 AND s.start_date_effective >= CONCAT(?, '-01')
       AND s.start_date_effective <= LAST_DAY(CONCAT(?, '-01')) ${branchClause}`,
    [month, month, ...branchParam]
  );
  const [newRows] = await pool.execute<RowDataPacket[]>(
    `SELECT s.emp_fkey, d.first_name, d.last_name, p.emp_branch, s.taxable_income,
            s.tax_yearly, s.tax_monthly_proj, s.surcharge, s.cess, s.rebate, s.fin_year,
            'New' AS regime
     FROM emp_tax_sal_trans_sum_new s
     JOIN emp_details d ON d.emp_pkey = s.emp_fkey
     JOIN emp_proff p ON p.emp_fkey = s.emp_fkey
     WHERE s.status = 1 AND s.start_date_effective >= CONCAT(?, '-01')
       AND s.start_date_effective <= LAST_DAY(CONCAT(?, '-01')) ${branchClause}`,
    [month, month, ...branchParam]
  );

  return NextResponse.json({ rows: [...oldRows, ...newRows] });
}
