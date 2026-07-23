import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getAttPeriod } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports AttendanceRegisterNewController::registerbook()'s process step: resolves the cycle via
// att_start_end_fn, then CALLs insert_update_att_reg (confirmed live signature: pbranch_code,
// pstart_date, pend_date, puserid, OUT poutput) — this proc does all the real per-day computation
// (holidays/weekoffs/leave/device-attendance-derived defaults); we just trigger it and read the
// result message.

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { branch, month } = body;
  if (!branch || !month) {
    return NextResponse.json({ error: 'branch and month are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const period = await getAttPeriod(pool, month);
  const userId = session.user.loginUserId ?? String(session.user.empFkey ?? 'system');

  await pool.query('CALL insert_update_att_reg(?, ?, ?, ?, @poutput)', [branch, period.start, period.end, userId]);
  const [[result]] = await pool.query<RowDataPacket[]>('SELECT @poutput AS poutput');

  return NextResponse.json({ success: true, message: result?.poutput ?? null, period });
}
