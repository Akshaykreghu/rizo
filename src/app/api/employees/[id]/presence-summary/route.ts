import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { fieldsToArray, computeAttendanceTotals, computeLiveAttendance, getNaPeriodBounds, getAttPeriod, toISODate } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Self-service attendance summary for the ESS "My Presence" calendar + trend chart. Reuses the
// same attendance_register FIELD1..32 day-code parsing as the admin register grid
// (GET /api/attendance/register) for any month that's been verified (isdelete='N'). For a month
// with no register row yet, or one that exists but was never verified, this ports
// DashboardController::empdashboard()'s own fallback (computeMonthlyBreakdownCounts) instead of
// leaving the month blank — real per-day attendance/leave data usually exists in
// emp_detail_timeattandance well before payroll ever processes/verifies the month's register.
// UTC-anchored (construction + increment) so this doesn't drift on a server east of UTC (e.g.
// IST) — a local-time construction combined with toISOString()'s always-UTC output would silently
// shift every date back by a day.
function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const empPkey = parseInt(id);
  if (session.user.userGroup !== 1 && session.user.empFkey !== empPkey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month') ?? new Date().toISOString().slice(0, 7);

  const [[emp]] = await pool.execute<RowDataPacket[]>(
    `SELECT e.emp_pkey, e.first_name, e.last_name, p.joining_date, p.day_time_seq,
            wdtp.day_time_desc AS shift_name, wdtp.minuts_calc_perday AS full_day_mins,
            wdtp.minutes_per_half AS half_day_mins, wdtp.on_dutty1 AS start_time, wdtp.off_dutty1 AS end_time,
            lpg.LEAVEPOLICY_GROUP_NAME AS leave_group_name
     FROM emp_details e
     LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
     LEFT JOIN working_day_time_procedures wdtp ON wdtp.day_time_seq = p.day_time_seq
     LEFT JOIN leavepolicy_group lpg ON lpg.LEAVEPOLICY_GROUP_ID = p.LEAVEPOLICY_GROUP_ID
     WHERE e.emp_pkey = ?`,
    [empPkey]
  );
  if (!emp) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Last 12 calendar months including the requested one, oldest first — the trend chart's window.
  const [reqYear, reqMonStr] = month.split('-').map(Number);
  const monthList: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(reqYear, reqMonStr - 1 - i, 1);
    monthList.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const allMonths = monthList.includes(month) ? monthList : [...monthList, month];

  const [registerRows] = await pool.execute<RowDataPacket[]>(
    `SELECT registerid, month_year, calander_days, isdelete,
            ${['FIELD1', ...Array.from({ length: 31 }, (_, i) => `FIELD${i + 2}`)].join(', ')}
     FROM attendance_register
     WHERE emp_fkey = ? AND month_year IN (${allMonths.map(() => '?').join(',')})`,
    [empPkey, ...allMonths]
  );
  const registerByMonth = new Map(registerRows.map((r) => [r.month_year as string, r]));

  const naBoundsMap = await getNaPeriodBounds(pool, [empPkey]);
  const naBounds = naBoundsMap[empPkey] ?? { joiningDate: null, lastWorkingDate: null };

  // Real attendance-cycle bounds per month (usually calendar-month, but not guaranteed — some
  // companies run e.g. 26th-to-25th cycles), not an assumed 1st-to-end-of-month range.
  const periods = new Map(
    await Promise.all(allMonths.map(async (m) => [m, await getAttPeriod(pool, m)] as const))
  );

  const monthlyAttendance = await Promise.all(
    monthList.map(async (m) => {
      const row = registerByMonth.get(m);
      const period = periods.get(m)!;
      if (row && row.isdelete === 'N') {
        const dates = enumerateDates(period.start, period.end);
        const totals = computeAttendanceTotals(fieldsToArray(row), dates, Number(row.calander_days) || null, naBounds.joiningDate, naBounds.lastWorkingDate);
        return { month: m, present: totals.presentTotal, absent: totals.lopTotal, leave_days: totals.leaveTotal };
      }
      const live = await computeLiveAttendance(pool, empPkey, period.start, period.end);
      return { month: m, present: live.totals.presentDays, absent: live.totals.lop, leave_days: live.totals.leaveDays };
    })
  );

  const currentRow = registerByMonth.get(month);
  const currentPeriod = periods.get(month)!;
  const currentDates = enumerateDates(currentPeriod.start, currentPeriod.end);

  const [punchRows] = await pool.execute<RowDataPacket[]>(
    `SELECT att_date, att_in_time, att_out_time, duration FROM emp_detail_timeattandance WHERE emp_pkey = ? AND att_date BETWEEN ? AND ?`,
    [empPkey, currentDates[0], currentDates[currentDates.length - 1]]
  );
  const punchByDate = new Map(punchRows.map((p) => [toISODate(p.att_date), p]));
  const todayIso = new Date().toISOString().slice(0, 10);
  const isCurrentMonth = todayIso.slice(0, 7) === month;

  let dayCodes: (string | null)[];
  if (currentRow && currentRow.isdelete === 'N') {
    dayCodes = fieldsToArray(currentRow).slice(0, currentDates.length);
  } else {
    const live = await computeLiveAttendance(pool, empPkey, currentPeriod.start, currentPeriod.end);
    dayCodes = live.days.map((d) => d.code);
  }

  const days = currentDates.map((date, i) => {
    const raw = (dayCodes[i] ?? '').toString().trim().toUpperCase();
    const status = raw.split('/')[0] || null;
    const punch = punchByDate.get(date);
    const d = new Date(date + 'T00:00:00');
    return {
      date, day: d.getDate(), dow: d.getDay(), status: status || null,
      punch_in: punch?.att_in_time ?? null, punch_out: punch?.att_out_time ?? null,
      worked_minutes: punch?.duration ?? null,
    };
  });
  const currentMonthPayload = { month, today: isCurrentMonth ? new Date().getDate() : days.length, days };

  return NextResponse.json({
    employee: {
      emp_pkey: emp.emp_pkey, first_name: emp.first_name, last_name: emp.last_name,
      joining_date: emp.joining_date, shift_name: emp.shift_name, leave_group_name: emp.leave_group_name,
    },
    shiftInfo: {
      fullDayMins: emp.full_day_mins || 480,
      halfDayMins: emp.half_day_mins || 240,
      startTime: emp.start_time || null,
      endTime: emp.end_time || null,
    },
    currentMonth: currentMonthPayload,
    monthlyAttendance,
  });
}
