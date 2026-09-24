import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { employeeSummary, employeeSummaryList } from '@/lib/employeeList';

// All Employees summary cards (legacy EmployeeJoinController::index()). With ?list=
// no_salary_structure | joined_this_month it returns the rows behind that card instead — the page
// turns them into the same PDF legacy's downloadMissingSalary() / thisMonthJoining() produced.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const list = new URL(request.url).searchParams.get('list');
  if (list === 'no_salary_structure' || list === 'joined_this_month') {
    return NextResponse.json({ data: await employeeSummaryList(pool, list) });
  }
  return NextResponse.json(await employeeSummary(pool));
}
