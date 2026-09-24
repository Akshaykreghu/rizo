import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { expenseDateError } from '@/lib/expenses';
import { NextRequest, NextResponse } from 'next/server';

// Live check behind the form's Expense Date (legacy EmployeeExpenses/salarycheck): tells the form
// straight away when a date is before joining or its month's salary is already processed.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const employee = session.user.userGroup === 1 ? Number(searchParams.get('employee')) : session.user.empFkey;
  const date = searchParams.get('date') ?? '';
  if (!employee || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'employee and date (YYYY-MM-DD) are required' }, { status: 400 });
  }
  const pool = await getCompanyPool(session.user.companyCode);
  return NextResponse.json({ error: await expenseDateError(pool, employee, date) });
}
