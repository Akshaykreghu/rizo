import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getTerminationContext, computeRemovalDays } from '@/lib/settlement';

// Mirrors legacy removeemps() (the non-KWMT/GRTL path): the terminal step, only reachable after
// admin approval. It takes no form — legacy fires a confirm() then one POST. It:
//  - flips emp_details.status to 2 (Terminated)
//  - clears OTHER employees' hierarchy references to this now-terminated manager (emp_proff.attr1)
//  - deactivates their HIERARCHY emp_config rows
//  - marks outstanding payroll / settlement / leave-encashment rows settled
//  - writes ONLY working_days_settled + payroll_days back to termination, both computed server-side
//    from the resignation window (see computeRemovalDays). The other termination columns are left
//    untouched, exactly as removeemps() leaves them.

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[req]] = await pool.execute<RowDataPacket[]>(
    `SELECT rr.emp_fkey, rr.Resignation_status, t.terminate_pkey
     FROM resignation_requests rr JOIN termination t ON t.Resignation_pkey = rr.Resignation_pkey AND t.status = 1
     WHERE rr.Resignation_pkey = ? AND rr.status = 1`,
    [id]
  );
  if (!req) return NextResponse.json({ error: 'Resignation request not found' }, { status: 404 });
  if (req.Resignation_status === 'Completed') {
    return NextResponse.json({ error: 'This resignation has already been finalized' }, { status: 409 });
  }

  // Legacy has no "approved" flag between approves() and removeemps() — removeemps() simply relies on
  // approves() having populated emp_settle_slip. Mirror that: the Full & Final step must have run
  // (settlement rows exist) before this terminal step is allowed.
  const [[settle]] = await pool.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM emp_settle_slip WHERE emp_fkey = ? AND status = 'Y'",
    [req.emp_fkey]
  );
  if (!settle || Number(settle.n) === 0) {
    return NextResponse.json(
      { error: 'Full & Final has not been processed for this employee yet' },
      { status: 409 }
    );
  }

  const ctx = await getTerminationContext(pool, id);
  if (!ctx) return NextResponse.json({ error: 'Resignation request not found' }, { status: 404 });
  const { workingDaysSettled, payrollDays } = await computeRemovalDays(pool, ctx);

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
      'UPDATE termination SET working_days_settled = ?, payroll_days = ? WHERE terminate_pkey = ?',
      [workingDaysSettled, payrollDays, req.terminate_pkey]
    );
    await connection.execute(
      "UPDATE resignation_requests SET Resignation_status = 'Completed' WHERE Resignation_pkey = ?",
      [id]
    );

    await connection.commit();
    return NextResponse.json({ success: true, workingDaysSettled, payrollDays });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
