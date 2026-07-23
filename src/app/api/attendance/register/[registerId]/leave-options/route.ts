import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getLeaveTypeOptions } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Feeds the day-cell edit modal's leave-type buttons + live balances, mirroring editPunch()'s
// view-prep (leave_balance_inthe_year_fn per policy-linked head).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ registerId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { registerId } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[reg]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_fkey, month_year FROM attendance_register WHERE registerid = ?',
    [registerId]
  );
  if (!reg) return NextResponse.json({ error: 'Register row not found' }, { status: 404 });

  const options = await getLeaveTypeOptions(pool, reg.emp_fkey, `${reg.month_year}-01`);
  return NextResponse.json({ options });
}
