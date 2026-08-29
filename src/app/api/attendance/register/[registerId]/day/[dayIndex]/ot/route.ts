import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getAttPeriod, getRegisterDayContext } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports DailyOvertimeVerifyNewController::updateSetDuration(), narrowed from its legacy bulk
// multi-employee/multi-date array shape to a single (emp_pkey, att_date) since it's now called from
// one day-cell's modal. Legacy's separate, narrower setRemarks() (remarks-only, no set_duration
// touch) is deliberately not ported here — this route's one Save always carries both fields, and
// updateSetDuration's own SET clause already covers remarks, so setRemarks would be a strict subset.
// Kept as legacy-only for now, per explicit decision to revisit only if a real gap shows up.
//
// value === '' clears the manual override (set_duration = NULL, is_manual = 'N'), matching legacy's
// own empty-value branch exactly.

export async function PUT(
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

  const body = await request.json();
  const { value, remark } = body as { value: number | ''; remark?: string };
  if (value === undefined || value === null || (value !== '' && Number(value) < 0)) {
    return NextResponse.json({ error: 'value is required and must be >= 0 (or empty to clear)' }, { status: 400 });
  }
  const remarkTrimmed = (remark ?? '').trim();

  const pool = await getCompanyPool(session.user.companyCode);
  const day = await getRegisterDayContext(pool, registerId, dayIdx);
  if (!day) return NextResponse.json({ error: 'Register row not found' }, { status: 404 });
  if (day.locked) {
    return NextResponse.json({ error: 'This month is verified/locked and cannot be edited' }, { status: 409 });
  }

  const [[existing]] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM emp_ot_timeattandance WHERE emp_pkey = ? AND att_date = ?`,
    [day.empFkey, day.attDate]
  );

  if (existing) {
    if (value !== '') {
      await pool.execute(
        `UPDATE emp_ot_timeattandance SET set_duration = ?, is_manual = 'Y', remarks = ? WHERE emp_pkey = ? AND att_date = ?`,
        [value, remarkTrimmed || null, day.empFkey, day.attDate]
      );
    } else {
      await pool.execute(
        `UPDATE emp_ot_timeattandance SET set_duration = NULL, is_manual = 'N', remarks = ? WHERE emp_pkey = ? AND att_date = ?`,
        [remarkTrimmed || null, day.empFkey, day.attDate]
      );
    }
  } else {
    if (value === '') {
      return NextResponse.json({ success: false, message: 'No overtime record found for this date' });
    }

    const period = await getAttPeriod(pool, day.attDate.slice(0, 7));
    let yearmonth = `${day.attDate.slice(0, 7)}-01`;
    if (day.attDate < period.start) {
      const d = new Date(`${yearmonth}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - 1);
      yearmonth = d.toISOString().slice(0, 10);
    } else if (day.attDate > period.end) {
      const d = new Date(`${yearmonth}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      yearmonth = d.toISOString().slice(0, 10);
    }

    await pool.execute(
      `INSERT INTO emp_ot_timeattandance (emp_pkey, att_date, set_duration, yearmonth, is_manual, remarks)
       VALUES (?, ?, ?, ?, 'Y', ?)`,
      [day.empFkey, day.attDate, value, yearmonth, remarkTrimmed || null]
    );
  }

  return NextResponse.json({ success: true });
}
