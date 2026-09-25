import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { reverseAppliedRule } from '@/lib/exceptionRules';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { exceptionAppliedPkey?: unknown } | null;
  const exceptionAppliedPkey = Number(body?.exceptionAppliedPkey);
  if (!Number.isInteger(exceptionAppliedPkey) || exceptionAppliedPkey < 1) {
    return NextResponse.json({ error: 'exceptionAppliedPkey is required' }, { status: 400 });
  }
  const pool = await getCompanyPool(session.user.companyCode);
  const message = await reverseAppliedRule(pool, exceptionAppliedPkey);
  if (message === null) return NextResponse.json({ error: 'Applied rule not found — it may already have been reversed' }, { status: 404 });
  return NextResponse.json({ success: true, message });
}
