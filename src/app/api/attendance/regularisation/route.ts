import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getAttPeriod, isLeaveAlreadyApplied } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports RegularisationController's live admin flow (adminindexnew/listadminregularizationnew) plus
// its hierarchy-approver flow (hierarchyindex/listhierarchyregularization). Legacy DOES route
// through a hierarchy head: employee_regularaization.approved_person is set from the requester's
// emp_proff.attr1 at raise time (bulkupdate_self()/savenew(), ~line 2168-2174) and confirmed live
// in this DB (approved_person values match emp_proff.attr1 for the same employees). hierarchyindex.ctp
// posts to the very same Regularisation/bulkupdate action the admin grid uses — same single-stage
// approve/reject, just a different queue. A userGroup 2 caller therefore has two distinct views here:
// `scope=own` (their own raised requests — default, unchanged from before) and `scope=hierarchy`
// (requests routed to them as approver, i.e. approved_person = their own emp_pkey).
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
  const scope = searchParams.get('scope') ?? 'own';
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
  } else if (scope === 'hierarchy') {
    // Hierarchy approver: requests routed to them, regardless of who raised them.
    conditions.push('er.approved_person = ?');
    values.push(String(session.user.empFkey!));
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

  // Route to the requester's hierarchy head, exactly like legacy's bulkupdate_self()/savenew()
  // (~line 2168-2174: `$hierarchy_head = $_POST["hierarchy_head"]`, sourced from emp_proff.attr1,
  // written into approved_person). Falls back to NULL (admin queue) if no hierarchy head is set,
  // same as legacy's `? $hierarchy_head : 0`-style fallback resolving to "no one" for un-configured
  // employees, which then simply falls through to the admin pending queue.
  const [[hierarchyRow]] = await pool.execute<RowDataPacket[]>(
    'SELECT attr1 FROM emp_proff WHERE emp_fkey = ?',
    [empFkey]
  );
  const approvedPerson = hierarchyRow?.attr1 || null;

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO employee_regularaization
       (att_date, C1, C3, empid, LOGDATE, LOGTIME, approved, approved_person, remarks, status, created_by, created_date)
     VALUES (?, ?, ?, ?, ?, ?, 'P', ?, ?, 1, ?, NOW())`,
    [attDate, direction, remarks ?? '', emp.emp_id, attDate, logTime, approvedPerson, remarks ?? '', session.user.loginUserId]
  );

  return NextResponse.json({ success: true, id: result.insertId });
}
