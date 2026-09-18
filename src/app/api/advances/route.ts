import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { createAdvance, listAdvances, isPayrollAlreadyProcessed } from '@/lib/advances';
import { NextRequest, NextResponse } from 'next/server';

// Employee self-service (userGroup !== 1) is scoped to their own emp_fkey on GET/POST, same
// precedent as attendance/regularisation and leave/encashment.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isAdmin = session.user.userGroup === 1;
  const empFkey = isAdmin ? request.nextUrl.searchParams.get('empFkey') : String(session.user.empFkey);
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
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as {
    empFkey?: number; advanceAmount: number; affectedMonth: string; remarks?: string; paymentDate?: string;
  };
  const empFkey = session.user.userGroup === 1 ? body.empFkey : session.user.empFkey;
  if (!empFkey || !body.advanceAmount || !body.affectedMonth) {
    return NextResponse.json({ error: 'empFkey, advanceAmount, affectedMonth are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const alreadyProcessed = await isPayrollAlreadyProcessed(pool, empFkey, body.affectedMonth);

  const id = await createAdvance(pool, { ...body, empFkey }, session.user.loginUserId);
  return NextResponse.json({
    id,
    warning: alreadyProcessed ? 'Payroll for this month is already processed for this employee.' : undefined,
  }, { status: 201 });
}
