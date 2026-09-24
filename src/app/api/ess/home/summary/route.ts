import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

type Rows = RowDataPacket[];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const minsOf = (t: unknown) => {
  const m = String(t ?? '').match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// Numbers for the employee home page's stat cards and "My team today", all from the employee's own
// day records (emp_detail_timeattandance) and shift:
//   week   — worked minutes per day Mon–Sun of the current week, against the shift's full-day
//            minutes × its working days that week.
//   month  — working days so far this month (shift working days up to today, less holidays), how
//            many were present, late (check-in after shift start + the shift's late-in limit),
//            on leave, and absent.
//   team   — direct reports (or, for someone with none, their manager and peers) with today's
//            status: on leave (authorized/approved leave today), in office (checked in today),
//            off today (week off / holiday) or not in yet.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const empFkey = Number(session.user.empFkey);
  if (!empFkey) return NextResponse.json({ error: 'Employee logins only' }, { status: 400 });
  const pool = await getCompanyPool(session.user.companyCode);

  const now = new Date();
  const today = iso(now);
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const weekDates = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return iso(d); });
  const monthStart = `${today.slice(0, 7)}-01`;

  const [[shift]] = await pool.execute<Rows>(
    `SELECT s.*, p.HOLIDAY_GROUP_ID FROM emp_proff p
     LEFT JOIN working_day_time_procedures s ON s.day_time_seq = p.day_time_seq WHERE p.emp_fkey = ?`,
    [empFkey]
  );
  const isWorkingDay = (date: string) => (shift ? shift[DAYS[new Date(`${date}T00:00:00`).getDay()]] === 'Y' : true);
  const fullDayMins = Number(shift?.minuts_calc_perday) || 480;

  const [holidayRows] = shift?.HOLIDAY_GROUP_ID
    ? await pool.execute<Rows>(
        `SELECT DATE_FORMAT(HOLIDAYDATE, '%Y-%m-%d') AS d FROM holidays WHERE HOLIDAY_GROUP_ID = ? AND status = 1 AND HOLIDAYDATE BETWEEN ? AND ?`,
        [shift.HOLIDAY_GROUP_ID, weekDates[0] < monthStart ? weekDates[0] : monthStart, weekDates[6] > today ? weekDates[6] : today]
      )
    : [[] as Rows];
  const holidays = new Set(holidayRows.map((h) => h.d as string));

  const from = weekDates[0] < monthStart ? weekDates[0] : monthStart;
  const [days] = await pool.execute<Rows>(
    `SELECT DATE_FORMAT(att_date, '%Y-%m-%d') AS d, DATE_FORMAT(att_in_time, '%H:%i') AS in_time, duration, present
     FROM emp_detail_timeattandance WHERE emp_pkey = ? AND att_date BETWEEN ? AND ?`,
    [empFkey, from, weekDates[6] > today ? weekDates[6] : today]
  );
  const dayMap = new Map(days.map((r) => [r.d as string, r]));

  const [leaveRows] = await pool.execute<Rows>(
    `SELECT DATE_FORMAT(elt.leave_date, '%Y-%m-%d') AS d FROM emp_leave_transactions elt
     JOIN leaveentries le ON le.LEAVEENTRYID = elt.LEAVEENTRYID
     WHERE le.EMP_fkey = ? AND elt.Leavestatus IN ('Authorized', 'Approved') AND elt.leave_date BETWEEN ? AND ?`,
    [empFkey, monthStart, today]
  );
  const leaveDays = new Set(leaveRows.map((l) => l.d as string));

  // ── week ──
  const week = weekDates.map((d) => ({
    date: d,
    minutes: Number(dayMap.get(d)?.duration) || 0,
    working: isWorkingDay(d) && !holidays.has(d),
    future: d > today,
  }));
  const weekTargetMins = week.filter((w) => w.working).length * fullDayMins;

  // ── month ──
  const lateLimit = Number(shift?.minuts_aftr_on_dutty_cal_late) || 0;
  const shiftStart = minsOf(shift?.on_dutty1);
  let workingDays = 0, present = 0, late = 0, onLeave = 0;
  for (let d = new Date(`${monthStart}T00:00:00`); iso(d) <= today; d.setDate(d.getDate() + 1)) {
    const date = iso(d);
    if (!isWorkingDay(date) || holidays.has(date)) continue;
    workingDays += 1;
    const row = dayMap.get(date);
    if (leaveDays.has(date)) { onLeave += 1; continue; }
    if (row?.in_time) {
      present += 1;
      const inMins = minsOf(row.in_time);
      if (shiftStart != null && inMins != null && inMins > shiftStart + lateLimit) late += 1;
    }
  }
  // Today isn't counted as absent until the shift day is over.
  const todayPending = isWorkingDay(today) && !holidays.has(today) && !dayMap.get(today)?.in_time && !leaveDays.has(today) ? 1 : 0;
  const absent = Math.max(0, workingDays - present - onLeave - todayPending);

  // ── team today ──
  const [[self]] = await pool.execute<Rows>('SELECT attr1 FROM emp_proff WHERE emp_fkey = ?', [empFkey]);
  const managerId = Number(self?.attr1) || 0;
  const [reports] = await pool.execute<Rows>(
    `SELECT e.emp_pkey FROM emp_details e JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
     WHERE e.status = 1 AND p.attr1 = ? AND e.emp_pkey != ?`,
    [empFkey, empFkey]
  );
  let teamIds = reports.map((r) => Number(r.emp_pkey));
  if (teamIds.length === 0 && managerId) {
    const [peers] = await pool.execute<Rows>(
      `SELECT e.emp_pkey FROM emp_details e JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
       WHERE e.status = 1 AND p.attr1 = ? AND e.emp_pkey != ?`,
      [managerId, empFkey]
    );
    teamIds = [managerId, ...peers.map((r) => Number(r.emp_pkey))];
  }
  let team: { emp_pkey: number; name: string; emp_code: string; profile_pic: string | null; status: 'in' | 'leave' | 'off' | 'notin' }[] = [];
  if (teamIds.length) {
    const ph = teamIds.map(() => '?').join(',');
    const [people] = await pool.query<Rows>(
      `SELECT e.emp_pkey, e.first_name, e.last_name, e.profile_pic, COALESCE(NULLIF(TRIM(p.emp_company_id), ''), e.emp_id) AS emp_code,
              s.Sunday, s.Monday, s.Tuesday, s.Wednesday, s.Thursday, s.Friday, s.Saturday, p.HOLIDAY_GROUP_ID,
              (SELECT COUNT(*) FROM emp_detail_timeattandance t WHERE t.emp_pkey = e.emp_pkey AND t.att_date = ? AND t.att_in_time IS NOT NULL) AS checked_in,
              (SELECT COUNT(*) FROM device_attandance da WHERE da.emp_id = e.emp_id AND DATE(da.LOGDATE) = ? AND da.status = 'Y') AS punches,
              (SELECT COUNT(*) FROM emp_leave_transactions elt JOIN leaveentries le ON le.LEAVEENTRYID = elt.LEAVEENTRYID
                WHERE le.EMP_fkey = e.emp_pkey AND elt.leave_date = ? AND elt.Leavestatus IN ('Authorized', 'Approved')) AS on_leave,
              (SELECT COUNT(*) FROM holidays h WHERE h.HOLIDAY_GROUP_ID = p.HOLIDAY_GROUP_ID AND h.status = 1 AND DATE(h.HOLIDAYDATE) = ?) AS holiday
       FROM emp_details e JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
       LEFT JOIN working_day_time_procedures s ON s.day_time_seq = p.day_time_seq
       WHERE e.emp_pkey IN (${ph}) ORDER BY e.first_name`,
      [today, today, today, today, ...teamIds]
    );
    const dayName = DAYS[now.getDay()];
    team = people.map((p) => ({
      emp_pkey: Number(p.emp_pkey),
      name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
      emp_code: String(p.emp_code ?? ''),
      profile_pic: p.profile_pic ?? null,
      status: Number(p.on_leave) > 0 ? 'leave'
        : Number(p.checked_in) > 0 || Number(p.punches) > 0 ? 'in'
        : Number(p.holiday) > 0 || (p[dayName] != null && p[dayName] !== 'Y') ? 'off'
        : 'notin',
    }));
  }

  return NextResponse.json({
    week: { days: week, workedMins: week.reduce((s, w) => s + w.minutes, 0), targetMins: weekTargetMins },
    month: { workingDays, present, late, onLeave, absent },
    team,
  });
}
