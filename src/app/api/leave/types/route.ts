import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getEmployeeLeaveTypes } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';

// Leave types applicable to one employee's leavepolicy group (salary_head_items WHERE item_type='LEAVE',
// joined through leavepolicy — matches LeaveRequestController's leave-type dropdown source).
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const employee = searchParams.get('employee');
  if (!employee) return NextResponse.json({ error: 'employee is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const types = await getEmployeeLeaveTypes(pool, Number(employee));
  return NextResponse.json({ data: types });
}
