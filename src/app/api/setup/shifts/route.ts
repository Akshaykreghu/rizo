import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader, Pool } from 'mysql2/promise';

const SHIFT_COLUMNS = [
  'day_time_desc',
  'Sunday', 'Sunday_F', 'Monday', 'Monday_F', 'Tuesday', 'Tuesday_F',
  'Wednesday', 'Wednesday_F', 'Thursday', 'Thursday_F', 'Friday', 'Friday_F',
  'Saturday', 'Saturday_F',
  'on_dutty1', 'off_dutty1', 'working_time1',
  'on_dutty2', 'off_dutty2', 'working_time2',
  'on_dutty3', 'off_dutty3', 'working_time3',
  'on_dutty4', 'off_dutty4', 'working_time4',
  'on_dutty5', 'off_dutty5', 'working_time5',
  'on_dutty6', 'off_dutty6', 'working_time6',
  'minuts_calc_perday', 'minuts_aftr_on_dutty_cal_late', 'minuts_bfr_off_dutty_cal_early',
  'min_cal_late_ifnoclockin', 'min_cal_leave_early_ifnoclockout',
  'min_aftr_off_dutty_cal_ot', 'min_bfr_on_dutty_cal_ot', 'work_time_day_off_cal_ot',
  'ot_eligibility_threshold', 'active', 'isnextday', 'shift_allowance', 'otcomponents',
  'start_date_effective', 'end_date_effective', 'strict_monitorings', 'minutes_per_half',
  'is_multiple_days', 'no_of_shift_days', 'is_exception', 'include_break',
  'first_in_last_punch',
  'working_time3_ex_day', 'working_time4_ex_day', 'working_time5_ex_day', 'working_time6_ex_day',
  'max_out_before_next_in', 'overtime_monitoring', 'max_in_time', 'max_out_time',
] as const;

function shiftValues(body: Record<string, unknown>): any[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const today = new Date().toISOString().slice(0, 10);
  const v: Record<string, unknown> = {
    day_time_desc: body.day_time_desc,
    Sunday: body.Sunday ?? 'N', Sunday_F: body.Sunday_F ?? 'N',
    Monday: body.Monday ?? 'N', Monday_F: body.Monday_F ?? 'N',
    Tuesday: body.Tuesday ?? 'N', Tuesday_F: body.Tuesday_F ?? 'N',
    Wednesday: body.Wednesday ?? 'N', Wednesday_F: body.Wednesday_F ?? 'N',
    Thursday: body.Thursday ?? 'N', Thursday_F: body.Thursday_F ?? 'N',
    Friday: body.Friday ?? 'N', Friday_F: body.Friday_F ?? 'N',
    Saturday: body.Saturday ?? 'N', Saturday_F: body.Saturday_F ?? 'N',
    on_dutty1: body.on_dutty1 ?? '', off_dutty1: body.off_dutty1 ?? '', working_time1: Number(body.working_time1) || 0,
    on_dutty2: body.on_dutty2 ?? '', off_dutty2: body.off_dutty2 ?? '', working_time2: body.working_time2 ?? '0',
    on_dutty3: body.on_dutty3 ?? null, off_dutty3: body.off_dutty3 ?? null, working_time3: body.working_time3 ?? null,
    on_dutty4: body.on_dutty4 ?? null, off_dutty4: body.off_dutty4 ?? null, working_time4: body.working_time4 ?? null,
    on_dutty5: body.on_dutty5 ?? null, off_dutty5: body.off_dutty5 ?? null, working_time5: body.working_time5 ?? null,
    on_dutty6: body.on_dutty6 ?? null, off_dutty6: body.off_dutty6 ?? null, working_time6: body.working_time6 ?? null,
    minuts_calc_perday: Number(body.minuts_calc_perday) || 0,
    minuts_aftr_on_dutty_cal_late: Number(body.minuts_aftr_on_dutty_cal_late) || 0,
    minuts_bfr_off_dutty_cal_early: Number(body.minuts_bfr_off_dutty_cal_early) || 0,
    min_cal_late_ifnoclockin: Number(body.min_cal_late_ifnoclockin) || 0,
    min_cal_leave_early_ifnoclockout: Number(body.min_cal_leave_early_ifnoclockout) || 0,
    min_aftr_off_dutty_cal_ot: Number(body.min_aftr_off_dutty_cal_ot) || 0,
    min_bfr_on_dutty_cal_ot: Number(body.min_bfr_on_dutty_cal_ot) || 0,
    work_time_day_off_cal_ot: Number(body.work_time_day_off_cal_ot) || 0,
    ot_eligibility_threshold: body.ot_eligibility_threshold ?? 'Y',
    active: Number(body.active) || 0,
    isnextday: Number(body.isnextday) || 0,
    shift_allowance: body.shift_allowance ?? '',
    otcomponents: body.otcomponents ?? '107',
    start_date_effective: body.start_date_effective || today,
    end_date_effective: body.end_date_effective || today,
    strict_monitorings: body.strict_monitorings ?? 'N',
    minutes_per_half: Number(body.minutes_per_half) || 0,
    is_multiple_days: body.is_multiple_days ?? 'N',
    no_of_shift_days: Number(body.no_of_shift_days) || 0,
    is_exception: Number(body.is_exception) || 0,
    include_break: body.include_break ?? 'N',
    first_in_last_punch: body.first_in_last_punch ?? 'N',
    working_time3_ex_day: body.working_time3_ex_day ?? 'N',
    working_time4_ex_day: body.working_time4_ex_day ?? 'N',
    working_time5_ex_day: body.working_time5_ex_day ?? 'N',
    working_time6_ex_day: body.working_time6_ex_day ?? 'N',
    max_out_before_next_in: body.max_out_before_next_in ?? 'Y',
    overtime_monitoring: body.overtime_monitoring ?? 'Y',
    max_in_time: body.max_in_time != null && body.max_in_time !== '' ? Number(body.max_in_time) : null,
    max_out_time: body.max_out_time != null && body.max_out_time !== '' ? Number(body.max_out_time) : null,
  };
  return SHIFT_COLUMNS.map((c) => v[c]);
}

async function insertExceptions(pool: Pool, shiftId: number, exceptions: unknown[], createdBy: string) {
  for (const ex of exceptions as Record<string, unknown>[]) {
    const values: any[] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
      shiftId,
      ex.ex_week_day,
      ex.ex_week,
      ex.week_off ?? 'N',
      ex.in_time || null,
      ex.out_time || null,
      ex.duration != null && ex.duration !== '' ? Number(ex.duration) : null,
      ex.full_day != null && ex.full_day !== '' ? Number(ex.full_day) : null,
      ex.half_day != null && ex.half_day !== '' ? Number(ex.half_day) : null,
      createdBy,
    ];
    await pool.execute(
      `INSERT INTO shift_exceptions
         (shift_id, ex_week_day, ex_week, week_off, in_time, out_time, duration, full_day, half_day, created_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      values
    );
  }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT day_time_seq, day_time_desc, active, isnextday, ot_eligibility_threshold, minuts_calc_perday
     FROM working_day_time_procedures WHERE active <> 0 ORDER BY day_time_desc`
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);

  const [dup] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM working_day_time_procedures WHERE day_time_desc = ? AND active <> 0',
    [body.day_time_desc]
  );
  if (dup.length) {
    return NextResponse.json({ error: 'Shift name already exists' }, { status: 409 });
  }

  const createdBy = session.user.loginUserId;
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO working_day_time_procedures
       (${SHIFT_COLUMNS.join(', ')}, created_by)
     VALUES (${SHIFT_COLUMNS.map(() => '?').join(', ')}, ?)`,
    [...shiftValues(body), createdBy]
  );

  if (Number(body.is_exception) === 1 && Array.isArray(body.exceptions)) {
    await insertExceptions(pool, result.insertId, body.exceptions, createdBy);
  }

  return NextResponse.json({ day_time_seq: result.insertId }, { status: 201 });
}

export { SHIFT_COLUMNS, shiftValues, insertExceptions };
