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
  const search = searchParams.get('search') ?? '';
  const empFkey = searchParams.get('emp_fkey');

  const conditions = ['rr.status = 1'];
  const values: (string | number)[] = [];
  if (empFkey) {
    conditions.push('rr.emp_fkey = ?');
    values.push(empFkey);
  }
  // Legacy listemployees() supports a name search only: CONCAT(first_name,' ',last_name) LIKE.
  if (search) {
    conditions.push("CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) LIKE ?");
    values.push(`%${search}%`);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT rr.Resignation_pkey, rr.emp_fkey, rr.applied_date, rr.Reason,
            rr.Reason_Desc, rr.Last_workingday, rr.Resignation_status,
            e.first_name, e.last_name, e.emp_id,
            b.branch_name,
            t.terminate_pkey, t.is_authorized, t.is_approved, t.submitted_date, t.last_applied_date,
            t.last_working_date, t.last_approved_working_date, t.notice_period, t.remarks,
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

  // Legacy's Separation form (form.ctp) lets the admin enter three distinct dates: the
  // resignation-submitted date (which feeds all settlement day-count math), the last applied
  // working date, and an approved last working date that may differ from the notice-derived one.
  // Missing values fall back the way legacy's asper_notice() JS auto-fills them.
  const dateSubmitted = String(body.date_submitted || today).slice(0, 10);
  const lastApplied = String(body.applied_date || dateSubmitted).slice(0, 10);
  const lastWorkingDay = String(body.last_workingday || '').slice(0, 10);
  const lastApprovedWd = String(body.last_approved_workingday || lastWorkingDay).slice(0, 10);
  const remarks = String(body.remarks ?? '').slice(0, 30); // termination.remarks is varchar(30)

  // Legacy form.ctp validation: applied/approved dates cannot precede the submitted date.
  if (lastApplied < dateSubmitted) {
    return NextResponse.json({ error: 'Last Applied Working Date cannot be before the Resignation Submitted date' }, { status: 400 });
  }
  if (lastApprovedWd < dateSubmitted) {
    return NextResponse.json({ error: 'Last Approved Working Date cannot be before the Resignation Submitted date' }, { status: 400 });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Legacy's form() excludes employees who already have an active termination row from the
    // New dropdown entirely (emp_pkey NOT IN (SELECT emp_fkey FROM termination WHERE status = 1)).
    // Block a duplicate filing rather than silently voiding the in-progress one. Withdrawn/cancelled
    // rows (status = 0 / Resignation_status Cancelled) don't block a fresh resignation.
    const [[inProgress]] = await connection.execute<RowDataPacket[]>(
      `SELECT rr.Resignation_pkey FROM resignation_requests rr
       WHERE rr.emp_fkey = ? AND rr.status = 1 AND rr.Resignation_status NOT IN ('Completed', 'Cancelled')
       LIMIT 1`,
      [body.emp_fkey]
    );
    if (inProgress) {
      await connection.rollback();
      return NextResponse.json({ error: 'This employee already has a resignation in progress' }, { status: 409 });
    }

    // authorised_to / Comments_to_manager / contact_no belong to legacy's employee self-service
    // request flow, not the admin Separation form ported here — legacy's own Terminate()
    // self-authorises admin separations (authorized_by = 0) and never sets those columns, so we
    // store 0 / '' and don't surface the fields.
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO resignation_requests
         (emp_fkey, authorised_to, Reason, Reason_Desc, Comments_to_manager, applied_date, Last_workingday, contact_no)
       VALUES (?, 0, ?, ?, '', ?, ?, '')`,
      [body.emp_fkey, body.reason, body.reason_desc ?? '', dateSubmitted, lastWorkingDay]
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
       VALUES (?, ?, ?, ?, 'N', 0, 'N', 0, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 1)`,
      [
        body.emp_fkey, body.reason, lastWorkingDay, body.reason_desc ?? '',
        dateSubmitted, lastApplied, lastWorkingDay, resignationPkey, lastApprovedWd, noticeDays, lastApprovedWd, remarks,
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
