import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getDailyOt, getRegisterDayContext, isOtEligibleDay } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Feeds the day-cell modal's Punches + Overtime sections in one round-trip: today's device_attandance
// punches (port of EditPunchesController's per-date list), whether this shift is OT-eligible (mirrors
// ot_duration_register_date's own cursor condition), and the current emp_ot_timeattandance row if any.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ registerId: string; dayIndex: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { registerId, dayIndex } = await params;
  const dayIdx = Number(dayIndex);
  if (!Number.isInteger(dayIdx) || dayIdx < 1 || dayIdx > 32) {
    return NextResponse.json({ error: 'dayIndex must be between 1 and 32' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const day = await getRegisterDayContext(pool, registerId, dayIdx);
  if (!day) return NextResponse.json({ error: 'Register row not found' }, { status: 404 });

  const [punches, otEligible, ot] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT device_attandance_seq, LOGDATE, C1 AS direction
       FROM device_attandance
       WHERE emp_id = ? AND SHIFTDATE = ? AND status = 'Y'
       ORDER BY LOGDATE`,
      [day.empId, day.attDate]
    ).then(([rows]) => rows),
    isOtEligibleDay(pool, day.empFkey, day.attDate),
    getDailyOt(pool, day.empFkey, day.attDate),
  ]);

  return NextResponse.json({ attDate: day.attDate, locked: day.locked, punches, otEligible, ot });
}
