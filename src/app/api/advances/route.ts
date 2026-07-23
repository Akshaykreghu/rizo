import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { createAdvance, listAdvances, isPayrollAlreadyProcessed } from '@/lib/advances';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const empFkey = request.nextUrl.searchParams.get('empFkey');
  const branch = request.nextUrl.searchParams.get('branch');
  const month = request.nextUrl.searchParams.get('month');

  const pool = await getCompanyPool(session.user.companyCode);
  const rows = await listAdvances(pool, {
    empFkey: empFkey ? Number(empFkey) : undefined,
    branchCode: branch ?? undefined,
    month: month ?? undefined,
  });
  return NextResponse.json({ rows });
}

// Mirrors EmployeeadvanceController::employeeloansave() (the advance-save handler). Legacy does
// not hard-block on already-processed payroll — it's an advisory-only warning surfaced separately
// via salarycheck() — so this mirrors that: returns a `warning` field rather than rejecting.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as {
    empFkey: number; advanceAmount: number; affectedMonth: string; remarks?: string; paymentDate?: string;
  };
  if (!body.empFkey || !body.advanceAmount || !body.affectedMonth) {
    return NextResponse.json({ error: 'empFkey, advanceAmount, affectedMonth are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const alreadyProcessed = await isPayrollAlreadyProcessed(pool, body.empFkey, body.affectedMonth);

  const id = await createAdvance(pool, body, session.user.loginUserId);
  return NextResponse.json({
    id,
    warning: alreadyProcessed ? 'Payroll for this month is already processed for this employee.' : undefined,
  }, { status: 201 });
}
