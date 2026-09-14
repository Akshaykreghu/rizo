import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getDailyOt, getRegisterDayContext, isOtEligibleDay } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Feeds the day-cell modal's Punches + Overtime sections in one round-trip: today's device_attandance
// punches (port of EditPunchesController's per-date list — status IN ('Y','N') so a punch toggled
// inactive still shows, badged, rather than disappearing; 'D' hard-deleted rows stay excluded), whether
// this shift is OT-eligible (mirrors ot_duration_register_date's own cursor condition), the current
// emp_ot_timeattandance row if any, and the day's computed in/out/duration/present from
// emp_detail_timeattandance (written by the live device_attandance_ai/au triggers whenever a punch is
// added or its status changes).

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

  const [punches, otEligible, ot, computedRow] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT device_attandance_seq, LOGDATE, C1 AS direction, status
       FROM device_attandance
       WHERE emp_id = ? AND SHIFTDATE = ? AND status IN ('Y', 'N')
       ORDER BY LOGDATE`,
      [day.empId, day.attDate]
    ).then(([rows]) => rows),
    isOtEligibleDay(pool, day.empFkey, day.attDate),
    getDailyOt(pool, day.empFkey, day.attDate),
    // The device_attandance_ai/au triggers derive this from the day's punches whenever one is
    // added/updated — surfaced here so the modal can show the computed duration, not just the raw
    // punch list (there was previously nowhere in the UI this was ever displayed).
    pool.execute<RowDataPacket[]>(
      `SELECT att_in_time, att_out_time, duration, present
       FROM emp_detail_timeattandance
       WHERE emp_pkey = ? AND att_date = ?
       ORDER BY emp_detail_timeattandance_pkey DESC LIMIT 1`,
      [day.empFkey, day.attDate]
    ).then(([rows]) => rows[0] as RowDataPacket | undefined),
  ]);

  const computedAttendance = computedRow
    ? {
        inTime: computedRow.att_in_time,
        outTime: computedRow.att_out_time,
        durationMin: computedRow.duration === null ? null : Number(computedRow.duration),
        present: computedRow.present,
      }
    : null;

  return NextResponse.json({ attDate: day.attDate, locked: day.locked, punches, otEligible, ot, computedAttendance });
}
