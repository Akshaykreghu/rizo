import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { FIELD_COLUMNS, getAttPeriod, upsertMonthlyOt } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports checkifregistercanverify() + verifyAttendance(): a register row can only be verified/locked
// (isdelete='Y' -> 'N') once every calendar day in its month has a non-blank FIELD value (legacy's
// "miss-punched date" gate). Also triggers ot_duration_register_date per employee, matching legacy's
// verifyAttendance() OT-duration recompute. Then generates/refreshes Monthly OT (emp_ot_master) for
// that employee — legacy's OtAttendanceNewController::getDurationRegister() only does this once
// attendance_register is verified for the month, which is exactly this moment.

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const registerIds: number[] = body.registerIds ?? [];
  if (registerIds.length === 0) {
    return NextResponse.json({ error: 'registerIds is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const placeholders = registerIds.map(() => '?').join(',');
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ar.registerid, ar.emp_fkey, ar.branch_code, ar.month_year, ar.calander_days, ar.emp_name, ${FIELD_COLUMNS.map((c) => `ar.${c}`).join(', ')}
     FROM attendance_register ar WHERE ar.registerid IN (${placeholders}) AND ar.isdelete = 'Y'`,
    registerIds
  );

  const verified: number[] = [];
  const skipped: { registerId: number; reason: string }[] = [];

  for (const row of rows) {
    const calendarDays = Number(row.calander_days);
    const missing = FIELD_COLUMNS.slice(0, calendarDays).some((col) => !row[col] || row[col].trim() === '');
    if (missing) {
      skipped.push({ registerId: row.registerid, reason: 'One or more dates are unmarked (miss-punched date)' });
      continue;
    }

    await pool.execute("UPDATE attendance_register SET isdelete = 'N' WHERE registerid = ?", [row.registerid]);

    for (let d = 1; d <= calendarDays; d++) {
      const attDate = `${row.month_year}-${String(d).padStart(2, '0')}`;
      try {
        await pool.query('SELECT ot_duration_register_date(?, ?, ?) AS r', [attDate, row.emp_fkey, row.branch_code]);
      } catch {
        // OT duration recompute is best-effort per day; a single bad date shouldn't block verification
      }
    }

    try {
      const period = await getAttPeriod(pool, row.month_year);
      await upsertMonthlyOt(pool, row.emp_fkey, row.emp_name ?? '', row.month_year, period);
    } catch {
      // Monthly OT generation is best-effort — a failure here shouldn't block attendance verification
    }

    verified.push(row.registerid);
  }

  return NextResponse.json({ verified, skipped });
}
