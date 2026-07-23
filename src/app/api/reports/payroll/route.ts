import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { generatePayrollReport, CriteriaRequiredError } from '@/lib/reports';
import { NextRequest, NextResponse } from 'next/server';

const SUBTYPES = [
  'SummaryPayroll', 'salary', 'Grosssalary', 'BankTranfer', 'Salaryslip',
  'MonthlyCTCReport', 'PayrollCTC', 'GrosssalaryNew', 'Comparison', 'GrosssalarySummary', 'GrossPeriod',
] as const;

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  if (!body.monthYear) return NextResponse.json({ error: 'monthYear is required' }, { status: 400 });
  const subtype = SUBTYPES.includes(body.subtype) ? body.subtype : 'SummaryPayroll';

  const pool = await getCompanyPool(session.user.companyCode);
  try {
    const rows = await generatePayrollReport(pool, {
      subtype,
      monthYear: body.monthYear,
      toMonthYear: body.toMonthYear || undefined,
      criteria: body.criteria ?? {},
    });
    return NextResponse.json({ rows });
  } catch (err) {
    if (err instanceof CriteriaRequiredError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
