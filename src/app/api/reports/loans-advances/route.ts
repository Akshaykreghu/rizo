import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { CriteriaRequiredError } from '@/lib/reports';
import { generateLoanReport, generateAdvanceReport } from '@/lib/loanAdvanceReports';
import { NextRequest, NextResponse } from 'next/server';

const TYPES = ['Loan', 'Advance'] as const;

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const type = TYPES.includes(body.type) ? body.type : 'Loan';
  const criteria = body.criteria ?? {};
  const includeResigned = !!body.includeResigned;
  const pool = await getCompanyPool(session.user.companyCode);

  try {
    let rows;
    if (type === 'Advance') {
      if (!body.monthYear) return NextResponse.json({ error: 'monthYear is required' }, { status: 400 });
      rows = await generateAdvanceReport(pool, { monthYear: body.monthYear, includeResigned, criteria });
    } else {
      if (!body.fromMonth || !body.toMonth) return NextResponse.json({ error: 'fromMonth and toMonth are required' }, { status: 400 });
      rows = await generateLoanReport(pool, {
        fromMonth: body.fromMonth, toMonth: body.toMonth, includeResigned,
        includeCompleted: !!body.includeCompleted, criteria,
      });
    }
    return NextResponse.json({ rows });
  } catch (err) {
    if (err instanceof CriteriaRequiredError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
