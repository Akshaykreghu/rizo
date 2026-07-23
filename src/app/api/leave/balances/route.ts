import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getEmployeeLeaveTypes, getLeaveBalance } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';

// Per-employee balance grid: every leave type in the employee's policy, each with today's balance.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const employee = searchParams.get('employee');
  if (!employee) return NextResponse.json({ error: 'employee is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const empFkey = Number(employee);
  const types = await getEmployeeLeaveTypes(pool, empFkey);
  const today = new Date().toISOString().slice(0, 10);

  const data = await Promise.all(
    types.map(async (t) => ({
      ...t,
      balance: await getLeaveBalance(pool, empFkey, t.salaryHeadItemFkey, today, t.allowNegative),
    }))
  );

  return NextResponse.json({ data });
}
