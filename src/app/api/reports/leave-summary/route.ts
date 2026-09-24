import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { CriteriaRequiredError } from '@/lib/reports';
import { generateLeaveSummaryReport } from '@/lib/leaveSummaryReport';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  if (!body.fromDate || !body.toDate) {
    return NextResponse.json({ error: 'fromDate and toDate are required' }, { status: 400 });
  }
  const pool = await getCompanyPool(session.user.companyCode);

  try {
    const rows = await generateLeaveSummaryReport(pool, {
      fromDate: body.fromDate,
      toDate: body.toDate,
      includeResigned: !!body.includeResigned,
      criteria: body.criteria ?? {},
    });
    return NextResponse.json({ rows });
  } catch (err) {
    if (err instanceof CriteriaRequiredError) return NextResponse.json({ error: err.message }, { status: 400 });
    const message = err instanceof Error ? err.message : 'Failed to generate report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
