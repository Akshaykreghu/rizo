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
  const body = (await request.json().catch(() => null)) as { branchCode?: unknown; ruleId?: unknown; month?: unknown } | null;
  const branchCode = typeof body?.branchCode === 'string' ? body.branchCode.trim() : '';
  const ruleId = Number(body?.ruleId);
  const month = typeof body?.month === 'string' ? body.month : '';
  if (!branchCode || !Number.isInteger(ruleId) || ruleId < 1 || !month) {
    return NextResponse.json({ error: 'Branch, month and rule are required' }, { status: 400 });
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: 'Month must be in YYYY-MM format' }, { status: 400 });
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
