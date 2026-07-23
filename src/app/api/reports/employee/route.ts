import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { generateEmployeeReport, CriteriaRequiredError } from '@/lib/reports';
import { NextRequest, NextResponse } from 'next/server';

const SUBTYPES = ['employeelist', 'salarystructure', 'shiftpolicy', 'leavepolicy', 'holiday'] as const;

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const subtype = SUBTYPES.includes(body.subtype) ? body.subtype : 'employeelist';
  const pool = await getCompanyPool(session.user.companyCode);
  try {
    const rows = await generateEmployeeReport(pool, {
      subtype,
      includeResigned: !!body.includeResigned,
      criteria: body.criteria ?? {},
    });
    return NextResponse.json({ rows });
  } catch (err) {
    if (err instanceof CriteriaRequiredError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
