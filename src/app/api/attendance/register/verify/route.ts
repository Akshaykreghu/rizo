import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { FIELD_COLUMNS } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports checkifregistercanverify() + verifyAttendance(): a register row can only be verified/locked
// (isdelete='Y' -> 'N') once every calendar day in its month has a non-blank FIELD value (legacy's
// "miss-punched date" gate). Also triggers ot_duration_register_date per employee, matching legacy's
// verifyAttendance() OT-duration recompute.

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
    `SELECT registerid, emp_fkey, branch_code, month_year, calander_days, ${FIELD_COLUMNS.join(', ')}
     FROM attendance_register WHERE registerid IN (${placeholders}) AND isdelete = 'Y'`,
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
    verified.push(row.registerid);
  }

  return NextResponse.json({ verified, skipped });
}
