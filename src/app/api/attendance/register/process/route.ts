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
//
// Before that, refresh OT: ot_duration_register_date(pdate, pemp_pkey, pbranch_code) is MODIFIES-SQL
// and its cursor matches on an exact emp_pkey, so — unlike legacy's own OtAttendanceNewController::
// Register(), which loops dates but leaves emp_pkey blank (a no-op against that cursor for
// whole-branch processing) — this loops every active employee in the branch × every date in the
// period, so emp_ot_timeattandance is genuinely current before insert_update_att_reg reads from it.

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

  const [employees] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_pkey FROM emp_details WHERE branch_code = ? AND status = 1',
    [branch]
  );

  const dates: string[] = [];
  for (let d = new Date(`${period.start}T00:00:00Z`); d <= new Date(`${period.end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }

  for (const date of dates) {
    for (const { emp_pkey } of employees) {
      await pool.query('SELECT ot_duration_register_date(?, ?, ?)', [date, emp_pkey, branch]);
    }
  }

  console.log('insert_update_att_reg params: ' + JSON.stringify({
    branch, periodStart: period.start, periodEnd: period.end, userId,
  }));
  await pool.query('CALL insert_update_att_reg(?, ?, ?, ?, @poutput)', [branch, period.start, period.end, userId]);
  const [[result]] = await pool.query<RowDataPacket[]>('SELECT @poutput AS poutput');

  return NextResponse.json({ success: true, message: result?.poutput ?? null, period });
}
