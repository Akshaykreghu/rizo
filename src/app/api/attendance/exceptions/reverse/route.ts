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
  const { exceptionAppliedPkey, branchCode, ruleId, monthYear } = (await request.json()) as {
    exceptionAppliedPkey: number; branchCode: string; ruleId: number; monthYear: string;
  };
  if (!exceptionAppliedPkey || !branchCode || !ruleId || !monthYear) {
    return NextResponse.json({ error: 'exceptionAppliedPkey, branchCode, ruleId and monthYear are required' }, { status: 400 });
  }
  const pool = await getCompanyPool(session.user.companyCode);
  const message = await reverseAppliedRule(pool, exceptionAppliedPkey, branchCode, ruleId, monthYear);
  return NextResponse.json({ success: true, message });
}
