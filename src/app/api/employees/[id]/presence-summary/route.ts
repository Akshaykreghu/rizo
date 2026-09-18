import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { fieldsToArray, computeAttendanceTotals, getNaPeriodBounds, toISODate } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Self-service attendance summary for the ESS "My Presence" calendar + trend chart. Reuses the
// same attendance_register FIELD1..32 day-code parsing as the admin register grid
// (GET /api/attendance/register), just scoped to one employee across several months instead of
// a whole branch for one month. If the current calendar month's register doesn't exist yet
// (payroll/attendance hasn't been processed for it — genuinely true for a lot of real data here),
// currentMonth.days comes back empty rather than fabricating one.
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

  const [registerRows] = await pool.execute<RowDataPacket[]>(
    `SELECT registerid, month_year, calander_days,
            ${['FIELD1', ...Array.from({ length: 31 }, (_, i) => `FIELD${i + 2}`)].join(', ')}
     FROM attendance_register
     WHERE emp_fkey = ? AND month_year IN (${monthList.map(() => '?').join(',')})`,
    [empPkey, ...monthList]
  );
  const registerByMonth = new Map(registerRows.map((r) => [r.month_year as string, r]));

  const naBoundsMap = await getNaPeriodBounds(pool, [empPkey]);
  const naBounds = naBoundsMap[empPkey] ?? { joiningDate: null, lastWorkingDate: null };

  function datesFor(m: string) {
    // month_year rows don't carry their own period bounds; derive calendar-month dates directly
    // (the register's own FIELD1..32 already reflect the attendance-period cycle for that label).
    const [y, mo] = m.split('-').map(Number);
    const daysInMonth = new Date(y, mo, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => `${y}-${String(mo).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
  }

  const monthlyAttendance = monthList.map((m) => {
    const row = registerByMonth.get(m);
    if (!row) return { month: m, present: 0, absent: 0, leave_days: 0 };
    const dates = datesFor(m);
    const totals = computeAttendanceTotals(fieldsToArray(row), dates, Number(row.calander_days) || null, naBounds.joiningDate, naBounds.lastWorkingDate);
    return { month: m, present: totals.presentTotal, absent: totals.lopTotal, leave_days: totals.leaveTotal };
  });

  const currentRow = registerByMonth.get(month);
  let currentMonthPayload = null;
  if (currentRow) {
    const dates = datesFor(month);
    const fields = fieldsToArray(currentRow);
    const [punchRows] = await pool.execute<RowDataPacket[]>(
      `SELECT att_date, att_in_time, att_out_time, duration FROM emp_detail_timeattandance WHERE emp_pkey = ? AND att_date BETWEEN ? AND ?`,
      [empPkey, dates[0], dates[dates.length - 1]]
    );
    const punchByDate = new Map(punchRows.map((p) => [toISODate(p.att_date), p]));
    const todayIso = new Date().toISOString().slice(0, 10);
    const isCurrentMonth = todayIso.slice(0, 7) === month;

    const days = dates.map((date, i) => {
      const raw = (fields[i] ?? '').trim().toUpperCase();
      const status = raw.split('/')[0] || null;
      const punch = punchByDate.get(date);
      const d = new Date(date);
      return {
        date, day: d.getDate(), dow: d.getDay(), status: status || null,
        punch_in: punch?.att_in_time ?? null, punch_out: punch?.att_out_time ?? null,
        worked_minutes: punch?.duration ?? null,
      };
    });
    currentMonthPayload = { month, today: isCurrentMonth ? new Date().getDate() : dates.length, days };
  }

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
