import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { toISODate } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports ShiftPlannerController::listemployees()/saveRoster(): per-day shift assignment for an
// employee across a month, defaulting to their primary SHIFT (emp_config type='SHIFT') unless
// overridden in emp_shift_planner, with secondary/multi shifts (type='MSHIFT') offered as
// alternatives in the dropdown.

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const empFkey = searchParams.get('empFkey');
  const month = searchParams.get('month');
  if (!empFkey || !month) {
    return NextResponse.json({ error: 'empFkey and month are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [[primary]] = await pool.execute<RowDataPacket[]>(
    `SELECT wdt.day_time_seq, wdt.day_time_desc, wdt.on_dutty1, wdt.off_dutty1, wdt.minuts_calc_perday
     FROM emp_config ec JOIN working_day_time_procedures wdt ON wdt.day_time_seq = ec.policy_id
     WHERE ec.emp_fkey = ? AND ec.type = 'SHIFT' AND ec.status = 1
     ORDER BY ec.id DESC LIMIT 1`,
    [empFkey]
  );

  const [secondary] = await pool.execute<RowDataPacket[]>(
    `SELECT wdt.day_time_seq, wdt.day_time_desc, wdt.on_dutty1, wdt.off_dutty1, wdt.minuts_calc_perday
     FROM emp_config ec JOIN working_day_time_procedures wdt ON wdt.day_time_seq = ec.policy_id
     WHERE ec.emp_fkey = ? AND ec.type = 'MSHIFT' AND ec.status = 2`,
    [empFkey]
  );

  const shiftOptions = [primary, ...secondary].filter(Boolean).map((s) => ({
    dayTimeSeq: s.day_time_seq,
    label: s.day_time_desc,
    onDuty: s.on_dutty1,
    offDuty: s.off_dutty1,
    minutesPerDay: s.minuts_calc_perday,
  }));

  const [roster] = await pool.execute<RowDataPacket[]>(
    `SELECT shift_date, shift_id FROM emp_shift_planner
     WHERE emp_fkey = ? AND month_year = ? AND status = 1`,
    [empFkey, month]
  );
  const rosterByDate = new Map(roster.map((r) => [toISODate(r.shift_date), r.shift_id]));

  const [[verified]] = await pool.execute<RowDataPacket[]>(
    `SELECT isdelete FROM attendance_register WHERE emp_fkey = ? AND month_year = ? LIMIT 1`,
    [empFkey, month]
  );
  const locked = verified?.isdelete === 'N';

  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    return { date, shiftId: rosterByDate.get(date) ?? primary?.day_time_seq ?? null };
  });

  return NextResponse.json({ shiftOptions, days, locked });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { empFkey, month, shifts } = body as { empFkey: number; month: string; shifts: Record<string, number> };
  if (!empFkey || !month || !shifts) {
    return NextResponse.json({ error: 'empFkey, month and shifts are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [[verified]] = await pool.execute<RowDataPacket[]>(
    `SELECT isdelete FROM attendance_register WHERE emp_fkey = ? AND month_year = ? LIMIT 1`,
    [empFkey, month]
  );
  if (verified?.isdelete === 'N') {
    return NextResponse.json(
      { error: 'Attendance already verified for this month. Please re-iterate attendance in Edit Attendance to reflect shift changes.' },
      { status: 409 }
    );
  }

  for (const [date, shiftId] of Object.entries(shifts)) {
    const [[existing]] = await pool.execute<RowDataPacket[]>(
      `SELECT planner_id FROM emp_shift_planner WHERE emp_fkey = ? AND shift_date = ? AND shift_id = ?`,
      [empFkey, date, shiftId]
    );
    await pool.execute(
      `UPDATE emp_shift_planner SET status = 0 WHERE emp_fkey = ? AND shift_date = ?`,
      [empFkey, date]
    );
    if (existing) {
      await pool.execute(`UPDATE emp_shift_planner SET status = 1 WHERE planner_id = ?`, [existing.planner_id]);
    } else {
      await pool.execute<ResultSetHeader>(
        `INSERT INTO emp_shift_planner (emp_fkey, shift_id, month_year, shift_date, creation_date, status)
         VALUES (?, ?, ?, ?, NOW(), 1)`,
        [empFkey, shiftId, month, date]
      );
    }
  }

  return NextResponse.json({ success: true });
}
