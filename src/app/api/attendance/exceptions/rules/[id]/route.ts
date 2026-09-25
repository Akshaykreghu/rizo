import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { updateRule, softDeleteRule, ruleExists, RuleNameExistsError, validateRuleInput, type RuleInput } from '@/lib/exceptionRules';
import { NextRequest, NextResponse } from 'next/server';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: 'Invalid rule id' }, { status: 400 });
  const input = (await request.json().catch(() => null)) as RuleInput;
  const invalid = validateRuleInput(input);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const pool = await getCompanyPool(session.user.companyCode);
  if (!(await ruleExists(pool, id))) return NextResponse.json({ error: 'Rule not found — it may have been deleted' }, { status: 404 });
  try {
    await updateRule(pool, id, input, session.user.loginUserId);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof RuleNameExistsError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: 'Invalid rule id' }, { status: 400 });
  const pool = await getCompanyPool(session.user.companyCode);
  if (!(await ruleExists(pool, id))) return NextResponse.json({ error: 'Rule not found — it may already have been deleted' }, { status: 404 });
  await softDeleteRule(pool, id);
  return NextResponse.json({ success: true });
}
