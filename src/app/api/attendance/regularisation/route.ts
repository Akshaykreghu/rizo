import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getAttPeriod, isLeaveAlreadyApplied } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports RegularisationController's live admin flow (adminindexnew/listadminregularizationnew).
// Legacy has no manager-approval hierarchy for this (is_manager/parent on emp_details are unused
// dead columns — confirmed, no controller reads them for routing), so employee self-service
// submissions go straight into the same admin pending queue admin-raised ones do; userGroup 2
// callers are scoped to their own emp_fkey on both GET and POST, admins see everyone.
// Table: employee_regularaization (sic — matches legacy's real, misspelled table name).

const STATUS_MAP: Record<string, string> = { pending: 'P', approved: 'A', rejected: 'R' };

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  const branch = searchParams.get('branch') ?? '';
  const status = searchParams.get('status') ?? '';
  if (!month) return NextResponse.json({ error: 'month is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const period = await getAttPeriod(pool, month);

  const conditions = ['er.att_date BETWEEN ? AND ?', 'er.status = 1'];
  const values: (string | number)[] = [period.start, period.end];
  if (session.user.userGroup === 1) {
    if (branch) {
      conditions.push('ed.branch_code = ?');
      values.push(branch);
    }
  } else {
    // Employee self-service: only ever your own requests, regardless of what's in the query string.
    conditions.push('ed.emp_pkey = ?');
    values.push(session.user.empFkey!);
  }
  if (status && STATUS_MAP[status]) {
    conditions.push('er.approved = ?');
    values.push(STATUS_MAP[status]);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT er.id, er.att_date, er.C1 AS direction, er.C3 AS remarks, er.LOGTIME, er.approved, er.status,
            ed.emp_pkey, ed.first_name, ed.last_name, ed.emp_id, b.branch_name
     FROM employee_regularaization er
     JOIN emp_details ed ON ed.emp_id = er.empid
     LEFT JOIN branches b ON b.branch_code = ed.branch_code
     WHERE ${conditions.join(' AND ')}
     ORDER BY er.att_date DESC`,
    values
  );

  return NextResponse.json({ period, data: rows });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { attDate, direction, logTime, remarks } = body as {
    empFkey: number; attDate: string; direction: 'in' | 'out'; logTime: string; remarks?: string;
  };
  // Employee self-service can only ever raise a request for themselves — the emp_fkey comes from
  // the session, not the request body, regardless of what a tampered payload sends.
  const empFkey = session.user.userGroup === 1 ? body.empFkey : session.user.empFkey;
  if (!empFkey || !attDate || !direction || !logTime) {
    return NextResponse.json({ error: 'empFkey, attDate, direction and logTime are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [[emp]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_id, branch_code FROM emp_details WHERE emp_pkey = ?',
    [empFkey]
  );
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const [[verified]] = await pool.execute<RowDataPacket[]>(
    `SELECT isdelete FROM attendance_register WHERE emp_fkey = ? AND month_year = ? LIMIT 1`,
    [empFkey, attDate.slice(0, 7)]
  );
  if (verified?.isdelete === 'N') {
    return NextResponse.json({ error: 'Attendance is already verified for this month' }, { status: 409 });
  }

  const alreadyLeave = await isLeaveAlreadyApplied(pool, empFkey, attDate, 3);
  if (alreadyLeave) {
    return NextResponse.json({ error: 'A leave already exists for this date' }, { status: 409 });
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO employee_regularaization
       (att_date, C1, C3, empid, LOGDATE, LOGTIME, approved, approved_person, remarks, status, created_by, created_date)
     VALUES (?, ?, ?, ?, ?, ?, 'P', NULL, ?, 1, ?, NOW())`,
    [attDate, direction, remarks ?? '', emp.emp_id, attDate, logTime, remarks ?? '', session.user.loginUserId]
  );

  return NextResponse.json({ success: true, id: result.insertId });
}
