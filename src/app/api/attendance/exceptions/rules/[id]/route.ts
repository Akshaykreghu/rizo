import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { updateRule, softDeleteRule, RuleNameExistsError, type RuleInput } from '@/lib/exceptionRules';
import { NextRequest, NextResponse } from 'next/server';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const input = (await request.json()) as RuleInput;
  if (!input.ruleName?.trim() || !input.ruleType?.trim()) {
    return NextResponse.json({ error: 'Rule name and rule type are required' }, { status: 400 });
  }
  const pool = await getCompanyPool(session.user.companyCode);
  try {
    await updateRule(pool, Number(id), input, session.user.loginUserId);
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
  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  await softDeleteRule(pool, Number(id));
  return NextResponse.json({ success: true });
}
