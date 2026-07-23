import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getCriteriaOptions } from '@/lib/reports';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const criteria = request.nextUrl.searchParams.get('criteria');
  if (!criteria) return NextResponse.json({ error: 'criteria is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const rows = await getCriteriaOptions(pool, criteria);
  return NextResponse.json({ rows });
}
