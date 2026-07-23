import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getActiveCriteria } from '@/lib/reports';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const type = request.nextUrl.searchParams.get('type');
  if (!type) return NextResponse.json({ error: 'type is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const rows = await getActiveCriteria(pool, type);
  return NextResponse.json({ rows });
}
