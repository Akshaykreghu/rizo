import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getAdvanceLimit } from '@/lib/advances';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const empFkey = request.nextUrl.searchParams.get('empFkey');
  if (!empFkey) return NextResponse.json({ error: 'empFkey is required' }, { status: 400 });
  // An advance limit is derived from CTC — an employee may only see their own, not query
  // anyone else's by guessing an id (matches every other self-service route's scoping).
  if (session.user.userGroup !== 1 && session.user.empFkey !== Number(empFkey)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const limit = await getAdvanceLimit(pool, Number(empFkey));
  return NextResponse.json({ limit });
}
