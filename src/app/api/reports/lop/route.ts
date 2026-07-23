import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { generateLopReport, CriteriaRequiredError } from '@/lib/reports';
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
    const rows = await generateLopReport(pool, {
      fromDate: body.fromDate,
      toDate: body.toDate,
      criteria: body.criteria ?? {},
    });
    return NextResponse.json({ rows });
  } catch (err) {
    if (err instanceof CriteriaRequiredError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
