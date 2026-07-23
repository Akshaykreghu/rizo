import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM db_config LIMIT 1');
  return NextResponse.json(rows[0] ?? null);
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  if (body.attendance_format !== 'A' && body.attendance_format !== 'B') {
    return NextResponse.json({ error: 'attendance_format must be A or B' }, { status: 400 });
  }
  const attendanceDate = Number(body.attendance_date);
  if (!Number.isInteger(attendanceDate) || attendanceDate < 0 || attendanceDate > 31) {
    return NextResponse.json({ error: 'attendance_date must be an integer 0-31' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  await pool.execute(
    `UPDATE db_config SET
       biometric_device_essl = ?, attendance_type = ?, attendance_format = ?, attendance_date = ?,
       emp_login = ?, payroll_type = ?, email_setup = ?, TDS_setup = ?, Salary_date = ?, active = ?,
       leave_url = ?, expense_url = ?, profile_url = ?, subdomain_url = ?,
       modified_date = CURDATE(), modified_by = ?`,
    [
      body.biometric_device_essl ?? 'N',
      body.attendance_type ?? '',
      body.attendance_format,
      attendanceDate,
      body.emp_login ?? 'N',
      body.payroll_type ?? '',
      body.email_setup ?? 'N',
      body.TDS_setup ?? 'N',
      Number(body.Salary_date) || 0,
      body.active ?? 'N',
      body.leave_url ?? '',
      body.expense_url ?? '',
      body.profile_url ?? '',
      body.subdomain_url ?? '',
      session.user.loginUserId,
    ]
  );
  return NextResponse.json({ success: true });
}
