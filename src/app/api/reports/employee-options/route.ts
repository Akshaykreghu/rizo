import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getEmployeeOptions } from '@/lib/reports';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const search = request.nextUrl.searchParams.get('search') ?? '';
  const includeResigned = request.nextUrl.searchParams.get('includeResigned') === '1';

  const pool = await getCompanyPool(session.user.companyCode);
  const rows = await getEmployeeOptions(pool, search, includeResigned);
  return NextResponse.json({ rows });
}
