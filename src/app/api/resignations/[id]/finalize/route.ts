import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors legacy removeemps(): the terminal step, only reachable after admin approval. Flips
// emp_details.status to 2 (Terminated), clears OTHER employees' hierarchy references to this
// now-terminated manager (not this employee's own attr1), deactivates their HIERARCHY emp_config
// rows, and marks outstanding payroll/settlement/leave-encashment rows settled. The
// working-days/payroll-days figures legacy computes from attendance are accepted as admin input
// here since Attendance Register doesn't exist in this port yet.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);

  const [[req]] = await pool.execute<RowDataPacket[]>(
    `SELECT rr.emp_fkey, rr.Resignation_status, t.terminate_pkey, t.is_approved
     FROM resignation_requests rr JOIN termination t ON t.Resignation_pkey = rr.Resignation_pkey AND t.status = 1
     WHERE rr.Resignation_pkey = ? AND rr.status = 1`,
    [id]
  );
  if (!req) return NextResponse.json({ error: 'Resignation request not found' }, { status: 404 });
  if (req.is_approved !== 'Y') {
    return NextResponse.json({ error: 'This resignation has not been approved yet' }, { status: 409 });
  }
  if (req.Resignation_status === 'Completed') {
    return NextResponse.json({ error: 'This resignation has already been finalized' }, { status: 409 });
  }

  const empFkey = req.emp_fkey;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute('UPDATE emp_details SET status = 2 WHERE emp_pkey = ?', [empFkey]);
    await connection.execute('UPDATE emp_proff SET attr1 = NULL WHERE attr1 = ?', [String(empFkey)]);
    await connection.execute(
      "UPDATE emp_config SET status = 0 WHERE type = 'HIERARCHY' AND policy_id = ? AND status = 1",
      [empFkey]
    );
    await connection.execute("UPDATE payroll_master SET approved = 'Y' WHERE emp_fkey = ? AND approved <> 'Y'", [empFkey]);
    await connection.execute("UPDATE emp_settle_slip SET approved = 'Y' WHERE emp_fkey = ? AND status = 'Y'", [empFkey]);
    await connection.execute("UPDATE leave_encashment_master SET salary_paid = 'Y' WHERE emp_fkey = ?", [empFkey]);

    await connection.execute(
      `UPDATE termination SET working_days_settled = ?, leave_balance = ?, approved_balance = ?,
              days_attendance = ?, encashed_days = ?, payroll_days = ?,
              amt_paid_by_empaddition = ?, amt_paid_by_empdeduction = ?
       WHERE terminate_pkey = ?`,
      [
        Number(body.working_days_settled ?? 0), Number(body.leave_balance ?? 0), Number(body.approved_balance ?? 0),
        Number(body.days_attendance ?? 0), Number(body.encashed_days ?? 0), Number(body.payroll_days ?? 0),
        Number(body.amt_paid_by_empaddition ?? 0), Number(body.amt_paid_by_empdeduction ?? 0),
        req.terminate_pkey,
      ]
    );
    await connection.execute(
      "UPDATE resignation_requests SET Resignation_status = 'Completed' WHERE Resignation_pkey = ?",
      [id]
    );

    await connection.commit();
    return NextResponse.json({ success: true });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
