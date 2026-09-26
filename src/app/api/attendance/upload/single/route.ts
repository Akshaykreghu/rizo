import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports EmployeeAttendanceUploadController::attendancesave() — the "New" single-record manual-entry
// form (legacy's form()/attendancesave()), a separate path from the Excel bulk-upload above. Legacy
// blocks the save if the month is already verified (attendance_register.isdelete='N') OR the day
// already has an emp_detail_timeattandance row — both are collapsed here into the one already-verified
// check the rest of this app already uses, since emp_detail_timeattandance is itself derived from the
// verified register. Saves two rows (in + out) the same way attendancesave() does; the existing
// emp_detailed_attendance_uploads_bi trigger promotes each into device_attandance exactly like the
// Excel upload path does — no separate logic needed here for that part.

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { empFkey, date, inTime, outTime } = body as {
    empFkey: number; date: string; inTime: string; outTime: string;
  };
  if (!empFkey || !date || !inTime || !outTime) {
    return NextResponse.json({ error: 'empFkey, date, inTime and outTime are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const monthYear = date.slice(0, 7);

  const [[verified]] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM attendance_register WHERE isdelete = 'N' AND emp_fkey = ? AND month_year = ? LIMIT 1`,
    [empFkey, monthYear]
  );
  if (verified) {
    return NextResponse.json({ error: "Can't add attendance. Attendance verified." }, { status: 409 });
  }

  await pool.execute<ResultSetHeader>(
    `INSERT INTO emp_detailed_attendance_uploads (emp_fkey, attendance_type, att_date, att_time, c1, created_by, is_updated, status)
     VALUES (?, 1, ?, ?, 'in', ?, '', 1)`,
    [empFkey, date, `${date} ${inTime}`, session.user.loginUserId]
  );
  await pool.execute<ResultSetHeader>(
    `INSERT INTO emp_detailed_attendance_uploads (emp_fkey, attendance_type, att_date, att_time, c1, created_by, is_updated, status)
     VALUES (?, 1, ?, ?, 'out', ?, '', 1)`,
    [empFkey, date, `${date} ${outTime}`, session.user.loginUserId]
  );

  return NextResponse.json({ success: true });
}
