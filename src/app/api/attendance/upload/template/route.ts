import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getAttPeriod } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import * as XLSX from 'xlsx';

// Mirrors EmployeeAttendanceUploadController::downloadempattendanceformat()'s real column shape:
// one column per calendar day in the month's attendance period (att_start_end_fn — not necessarily
// the 1st-to-last-day calendar month), plus Employee ID/Name/Direction. "Employee ID" is the login
// user_id (user_credentials.user_id), matching uploadandsaveempctc()'s own lookup — same convention
// already used by the Leave bulk-upload template. Rows are pre-filled with active employees who
// have a login (upload can't resolve an emp_fkey without one); Direction and date cells are left
// blank for the admin to fill in per employee (legacy's own template doesn't pre-split rows by
// direction — one row covers one direction; duplicate a row to also record the other punch).

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  const branch = searchParams.get('branch') ?? '';
  if (!month) return NextResponse.json({ error: 'month is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const period = await getAttPeriod(pool, month);

  const dates: string[] = [];
  const cursor = new Date(`${period.start}T00:00:00Z`);
  const end = new Date(`${period.end}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const conditions = ['ed.status = 1'];
  const args: string[] = [];
  if (branch) {
    conditions.push('ed.branch_code = ?');
    args.push(branch);
  }
  const [employees] = await pool.execute<RowDataPacket[]>(
    `SELECT uc.user_id, CONCAT(ed.first_name, ' ', COALESCE(ed.last_name, '')) AS emp_name
     FROM emp_details ed
     JOIN user_credentials uc ON uc.emp_fkey = ed.emp_pkey
     WHERE ${conditions.join(' AND ')}
     ORDER BY ed.first_name`,
    args
  );

  const headers = ['Employee ID *', 'Employee Name', 'Direction * (in/out)', ...dates];
  const rows = employees.map((e) => [e.user_id, e.emp_name, '', ...dates.map(() => '')]);

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance Upload');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="attendance_upload_${month}.xlsx"`,
    },
  });
}
