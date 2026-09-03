import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { toISODate } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports ScheduledBreakOffController::listbreakoffdatesforsbospecial/-special-all() — the date
// picker for the "Special Events Attendance" (legacy: Scheduled Break-Off) screen. `scope=off`
// (default, matches the "Attendance" override use case — calling people in on a day that's
// already a week-off/holiday) restricts to dates the month's cached rows show as weekoff/holiday;
// `scope=all` (matches the "Week Off" override use case — forcing an off day on what would
// otherwise be a working day) returns every distinct date the month has cached rows for.

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  const scope = searchParams.get('scope') === 'all' ? 'all' : 'off';
  if (!month) return NextResponse.json({ error: 'month is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT DISTINCT att_date FROM emp_detail_timeattandance
     WHERE yearmonth = ? ${scope === 'off' ? 'AND (weekoff IS NOT NULL OR holiday IS NOT NULL)' : ''}
     ORDER BY att_date`,
    [`${month}-01`]
  );

  return NextResponse.json({ dates: rows.map((r) => toISODate(r.att_date)) });
}
