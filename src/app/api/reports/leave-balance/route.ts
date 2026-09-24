import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { CriteriaRequiredError } from '@/lib/reports';
import { generateLeaveBalanceReport } from '@/lib/leaveBalanceReport';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  if (!body.asOfDate) return NextResponse.json({ error: 'asOfDate is required' }, { status: 400 });
  const pool = await getCompanyPool(session.user.companyCode);

  try {
    const rows = await generateLeaveBalanceReport(pool, { asOfDate: body.asOfDate, criteria: body.criteria ?? {} });
    return NextResponse.json({ rows });
  } catch (err) {
    if (err instanceof CriteriaRequiredError) return NextResponse.json({ error: err.message }, { status: 400 });
    // Surfaced as JSON instead of rethrown — a rethrow here hits Next's default error handler,
    // which on this deployment returns an empty body (the client then fails on res.json() with
    // "unexpected end of data" instead of showing the real cause).
    const message = err instanceof Error ? err.message : 'Failed to generate report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
