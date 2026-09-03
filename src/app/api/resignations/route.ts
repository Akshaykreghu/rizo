import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Mirrors legacy ResignationRequestController/EmployeeResignationController: a 4-stage
// workflow across 3 tables. Stage 1 (this route) submits resignation_requests AND a
// termination row simultaneously (matches legacy's Saverequests()). termination's settlement
// columns are NOT NULL with no defaults, so they start at 0/placeholder and get filled in at
// the final removeemps()-equivalent step.

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? '';
  const search = searchParams.get('search') ?? '';
  const empFkey = searchParams.get('emp_fkey');

  const conditions = ['rr.status = 1'];
  const values: (string | number)[] = [];
  if (empFkey) {
    conditions.push('rr.emp_fkey = ?');
    values.push(empFkey);
  }
  if (status) {
    conditions.push('rr.Resignation_status = ?');
    values.push(status);
  }
  if (search) {
    conditions.push('(e.first_name LIKE ? OR e.last_name LIKE ? OR e.emp_id LIKE ? OR rr.Reason LIKE ?)');
    values.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT rr.Resignation_pkey, rr.emp_fkey, rr.authorised_to, rr.applied_date, rr.Reason,
            rr.Reason_Desc, rr.Comments_to_manager, rr.Last_workingday, rr.contact_no, rr.Resignation_status,
            e.first_name, e.last_name, e.emp_id,
            b.branch_name,
            t.terminate_pkey, t.is_authorized, t.is_approved, t.last_approved_working_date, t.remarks,
            ra.resignation_accept_pkey, ra.chek_formalities, ra.chek_assets, ra.chek_leave
     FROM resignation_requests rr
     JOIN emp_details e ON e.emp_pkey = rr.emp_fkey
     LEFT JOIN emp_proff p ON p.emp_fkey = rr.emp_fkey
     LEFT JOIN branches b ON b.branch_code = p.emp_branch
     LEFT JOIN termination t ON t.Resignation_pkey = rr.Resignation_pkey AND t.status = 1
     LEFT JOIN resignation_accept ra ON ra.Resignation_pkey = rr.Resignation_pkey AND ra.status = 1
     WHERE ${conditions.join(' AND ')}
     ORDER BY rr.Resignation_pkey DESC`,
    values
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
  const today = new Date().toISOString().slice(0, 10);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Deactivate any prior cancelled termination row for this employee — legacy keeps history
    // rather than overwriting.
    await connection.execute(
      "UPDATE termination SET status = 0 WHERE emp_fkey = ? AND status = 1",
      [body.emp_fkey]
    );

    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO resignation_requests
         (emp_fkey, authorised_to, Reason, Reason_Desc, Comments_to_manager, Last_workingday, contact_no)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        body.emp_fkey, body.authorised_to, body.reason, body.reason_desc ?? '',
        body.comments_to_manager ?? '', body.last_workingday, body.contact_no ?? '',
      ]
    );
    const resignationPkey = result.insertId;

    const [[proff]] = await connection.execute<RowDataPacket[]>(
      'SELECT notice_days FROM emp_proff WHERE emp_fkey = ?',
      [body.emp_fkey]
    );
    const noticeDays = Number(proff?.notice_days ?? 0);

    await connection.execute(
      `INSERT INTO termination
         (emp_fkey, Reason, ed, Reason_desc, is_authorized, authorized_by, is_approved, approved_by,
          submitted_date, last_applied_date, last_working_date, Resignation_pkey,
          last_approved_working_date, notice_period, act_last_working_day, remarks,
          working_days_settled, leave_balance, approved_balance, days_attendance, encashed_days,
          payroll_days, amt_paid_by_empaddition, amt_paid_by_empdeduction, status)
       VALUES (?, ?, ?, ?, 'N', 0, 'N', 0, ?, ?, ?, ?, ?, ?, ?, '', 0, 0, 0, 0, 0, 0, 0, 0, 1)`,
      [
        body.emp_fkey, body.reason, body.last_workingday, body.reason_desc ?? '',
        today, today, body.last_workingday, resignationPkey, body.last_workingday, noticeDays, body.last_workingday,
      ]
    );

    await connection.commit();
    return NextResponse.json({ resignation_pkey: resignationPkey }, { status: 201 });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
