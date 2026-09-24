import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getExpensePeople } from '@/lib/expenses';
import { NextRequest, NextResponse } from 'next/server';

// Authorized By / Approved By options for the expense request form (legacy EmployeeExpenses/form).
// Employees get their own lists; an admin passes ?employee=<emp_pkey>.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const employee = session.user.userGroup === 1
    ? Number(new URL(request.url).searchParams.get('employee'))
    : session.user.empFkey;
  if (!employee) return NextResponse.json({ error: 'employee is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  return NextResponse.json(await getExpensePeople(pool, session.user.companyCode, employee));
}
