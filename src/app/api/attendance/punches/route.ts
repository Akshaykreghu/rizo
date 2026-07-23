import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getAttPeriod } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports EditPunchesController's raw punch list/add (listpunchesnew/savepunch), with an explicit,
// narrow request body instead of legacy's raw-$_POST-to-save() (a real bug — arbitrary columns on
// device_attandance/device_attandance_hist could be set from an unfiltered request body).

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const empFkey = searchParams.get('empFkey');
  const month = searchParams.get('month');
  if (!empFkey || !month) {
    return NextResponse.json({ error: 'empFkey and month are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [[emp]] = await pool.execute<RowDataPacket[]>('SELECT emp_id FROM emp_details WHERE emp_pkey = ?', [empFkey]);
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const period = await getAttPeriod(pool, month);

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT device_attandance_seq, LOGDATE, SHIFTDATE, C1 AS direction, status
     FROM device_attandance
     WHERE emp_id = ? AND SHIFTDATE BETWEEN ? AND ? AND status = 'Y'
     ORDER BY LOGDATE`,
    [emp.emp_id, period.start, period.end]
  );

  return NextResponse.json({ period, empId: emp.emp_id, data: rows });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { empFkey, logDate, logTime, direction } = body as {
    empFkey: number; logDate: string; logTime: string; direction: 'in' | 'out';
  };
  if (!empFkey || !logDate || !logTime || !direction) {
    return NextResponse.json({ error: 'empFkey, logDate, logTime and direction are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const [[emp]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_id, company_code, branch_code FROM emp_details WHERE emp_pkey = ?',
    [empFkey]
  );
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const logDateTime = `${logDate} ${logTime}`;
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO device_attandance (company_code, branch_code, emp_id, LOGDATE, SHIFTDATE, C1, C2, status)
     VALUES (?, ?, ?, ?, ?, ?, 'MAN', 'Y')`,
    [emp.company_code, emp.branch_code, emp.emp_id, logDateTime, logDate, direction]
  );
  await pool.execute(
    `INSERT INTO device_attandance_hist
       (device_attandance_seq, company_code, branch_code, emp_id, LOGDATE, C1, C2, status, created_by, action)
     VALUES (?, ?, ?, ?, ?, ?, 'MAN', 'Y', ?, 'I')`,
    [result.insertId, emp.company_code, emp.branch_code, emp.emp_id, logDateTime, direction, session.user.loginUserId]
  );

  return NextResponse.json({ success: true, id: result.insertId });
}
