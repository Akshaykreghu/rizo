import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { generateEpfContributionReport } from '@/lib/statutoryUpload';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  if (!body.monthYear) return NextResponse.json({ error: 'monthYear is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const rows = await generateEpfContributionReport(pool, {
    monthYear: body.monthYear,
    branch: body.branch || undefined,
  });
  return NextResponse.json({ rows });
}
