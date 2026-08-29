import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getAttPeriod, getPolicyLopMap, fieldsToArray, isPolicyLeaveForDate, toISODate, getMonthlyOtMap } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors AttendanceRegisterNewController::registerbook() (read side): lists attendance_register
// rows for a branch/month, split into Not-Verified (isdelete='Y') / Verified (isdelete='N') tabs,
// plus the per-day cell color hints (policy-leave vs indirect LOP) and expandable IN/OUT/Duration/OT
// detail sourced from emp_detail_timeattandance and emp_ot_timeattandance. Also attaches Monthly OT
// (emp_ot_master) per employee — only populated once the register verify step has generated it.

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  const branch = searchParams.get('branch');
  const statusParam = searchParams.get('status') === 'verified' ? 'verified' : 'unverified';
  if (!month || !branch) {
    return NextResponse.json({ error: 'month and branch are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const period = await getAttPeriod(pool, month);
  const isdelete = statusParam === 'verified' ? 'N' : 'Y';

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ar.registerid, ar.emp_fkey, ar.emp_company_id, ar.emp_name,
            ar.presant_total, ar.leave_total, ar.lop_total, ar.weekoff_total, ar.na_wo_count,
            ar.holiday_total, ar.na_ho_count, ar.working_days, ar.calander_days,
            ${['FIELD1', ...Array.from({ length: 31 }, (_, i) => `ar.FIELD${i + 2}`)].join(', ')},
            COALESCE(ss.prorate_code, 1) AS prorate_code
     FROM attendance_register ar
     LEFT JOIN emp_proff ep ON ep.emp_fkey = ar.emp_fkey
     LEFT JOIN salary_structure ss ON ss.structure_id = ep.structure_id
     WHERE ar.branch_code = ? AND ar.month_year = ? AND ar.isdelete = ?
     ORDER BY ar.emp_name`,
    [branch, month, isdelete]
  );

  const empFkeys = rows.map((r) => r.emp_fkey);
  let punchesByEmp: Record<number, Record<string, RowDataPacket>> = {};
  if (empFkeys.length > 0) {
    const placeholders = empFkeys.map(() => '?').join(',');
    const [punchRows] = await pool.execute<RowDataPacket[]>(
      `SELECT emp_pkey, att_date, att_in_time, att_out_time, duration
       FROM emp_detail_timeattandance
       WHERE emp_pkey IN (${placeholders}) AND att_date BETWEEN ? AND ?`,
      [...empFkeys, period.start, period.end]
    );
    punchesByEmp = {};
    for (const p of punchRows) {
      const emp = p.emp_pkey;
      const date = toISODate(p.att_date);
      if (!punchesByEmp[emp]) punchesByEmp[emp] = {};
      punchesByEmp[emp][date] = p;
    }
  }

  let otByEmp: Record<number, Record<string, RowDataPacket>> = {};
  if (empFkeys.length > 0) {
    const placeholders = empFkeys.map(() => '?').join(',');
    const [otRows] = await pool.execute<RowDataPacket[]>(
      `SELECT emp_pkey, att_date, ot_duration, set_duration, is_manual
       FROM emp_ot_timeattandance
       WHERE emp_pkey IN (${placeholders}) AND att_date BETWEEN ? AND ?`,
      [...empFkeys, period.start, period.end]
    );
    otByEmp = {};
    for (const o of otRows) {
      const emp = o.emp_pkey;
      const date = toISODate(o.att_date);
      if (!otByEmp[emp]) otByEmp[emp] = {};
      otByEmp[emp][date] = o;
    }
  }

  const lopMap = await getPolicyLopMap(pool, branch, period.start, period.end);
  const monthlyOtMap = await getMonthlyOtMap(pool, empFkeys, month);

  const calendarDayCount = Math.round(
    (new Date(period.end).getTime() - new Date(period.start).getTime()) / 86400000
  ) + 1;
  const dates = Array.from({ length: calendarDayCount }, (_, i) => {
    const d = new Date(period.start);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });

  const data = rows.map((row) => {
    const fields = fieldsToArray(row);
    const days = dates.map((date, i) => {
      const value = fields[i] ?? '';
      const punch = punchesByEmp[row.emp_fkey]?.[date];
      const ot = otByEmp[row.emp_fkey]?.[date];
      // Effective OT: the manual override (set_duration) once one exists, else the computed value.
      const otMinutes = ot ? (ot.is_manual === 'Y' ? ot.set_duration : ot.ot_duration) : null;
      return {
        date,
        value,
        isPolicyLeave: isPolicyLeaveForDate(lopMap, row.emp_fkey, date),
        inTime: punch?.att_in_time ?? null,
        outTime: punch?.att_out_time ?? null,
        duration: punch?.duration ?? null,
        otDuration: otMinutes != null ? Number(otMinutes) : null,
      };
    });
    return {
      registerId: row.registerid,
      empFkey: row.emp_fkey,
      empId: row.emp_company_id,
      empName: row.emp_name,
      presentTotal: Number(row.presant_total),
      leaveTotal: Number(row.leave_total),
      lopTotal: Number(row.lop_total),
      weekoffTotal: Number(row.weekoff_total),
      naWoCount: Number(row.na_wo_count),
      holidayTotal: Number(row.holiday_total),
      naHoCount: Number(row.na_ho_count),
      workingDays: Number(row.working_days),
      calendarDays: Number(row.calander_days),
      prorateCode: Number(row.prorate_code),
      monthlyOt: monthlyOtMap[row.emp_fkey] ?? null,
      days,
    };
  });

  return NextResponse.json({ period, status: statusParam, data });
}
