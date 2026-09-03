import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { applyRule, ApplyRuleError } from '@/lib/exceptionRules';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { branchCode, ruleId, month } = (await request.json()) as { branchCode: string; ruleId: number; month: string };
  if (!branchCode || !ruleId || !month) {
    return NextResponse.json({ error: 'branchCode, ruleId and month are required' }, { status: 400 });
  }
  const pool = await getCompanyPool(session.user.companyCode);
  try {
    const message = await applyRule(pool, branchCode, ruleId, month, session.user.loginUserId);
    return NextResponse.json({ success: true, message });
  } catch (err) {
    if (err instanceof ApplyRuleError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
