import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { listRules, createRule, RuleNameExistsError, validateRuleInput, type RuleInput } from '@/lib/exceptionRules';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const pool = await getCompanyPool(session.user.companyCode);
  return NextResponse.json({ data: await listRules(pool) });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const input = (await request.json().catch(() => null)) as RuleInput;
  const invalid = validateRuleInput(input);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const pool = await getCompanyPool(session.user.companyCode);
  try {
    const exceptionId = await createRule(pool, input, session.user.loginUserId);
    return NextResponse.json({ success: true, exceptionId });
  } catch (err) {
    if (err instanceof RuleNameExistsError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
