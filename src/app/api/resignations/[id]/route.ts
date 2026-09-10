import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors legacy's row-state rule (EmployeeResignationController::index.ctp's Edit/Delete gating):
// legacy locks Edit/Delete once the employee has actually been terminated (emp_details.status = 2,
// the same signal our own eligibility/settlement checks use), not at any of the intermediate
// resignation-workflow stages. In our status model that's exactly Resignation_status = 'Completed' —
// Applied/HR Reviewed/Approved all stay editable, only Completed locks.

export async function PUT(
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
    'SELECT emp_fkey, Resignation_status, applied_date FROM resignation_requests WHERE Resignation_pkey = ? AND status = 1',
    [id]
  );
  if (!req) return NextResponse.json({ error: 'Resignation request not found' }, { status: 404 });
  if (req.Resignation_status === 'Completed') {
    return NextResponse.json({ error: 'This resignation is already finalized and can no longer be edited' }, { status: 409 });
  }

  const [[proff]] = await pool.execute<RowDataPacket[]>(
    'SELECT notice_days, joining_date FROM emp_proff WHERE emp_fkey = ?',
    [req.emp_fkey]
  );
  const noticeDays = Number(proff?.notice_days ?? 0);

  const fallbackSubmitted = req.applied_date
    ? new Date(req.applied_date).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const dateSubmitted = String(body.date_submitted || fallbackSubmitted).slice(0, 10);
  const lastApplied = String(body.applied_date || dateSubmitted).slice(0, 10);
  const lastWorkingDay = String(body.last_workingday || '').slice(0, 10);
  const lastApprovedWd = String(body.last_approved_workingday || lastWorkingDay).slice(0, 10);
  const remarks = String(body.remarks ?? '').slice(0, 30); // termination.remarks is varchar(30)

  if (lastApplied < dateSubmitted) {
    return NextResponse.json({ error: 'Last Applied Working Date cannot be before the Resignation Submitted date' }, { status: 400 });
  }
  if (lastApprovedWd < dateSubmitted) {
    return NextResponse.json({ error: 'Last Approved Working Date cannot be before the Resignation Submitted date' }, { status: 400 });
  }

  // Legacy getperiod() floors the submitted-date picker at emp_proff.joining_date (setStartDate).
  // Skip when joining_date is missing / '0000-00-00' (some migrated rows).
  const joiningDate = proff?.joining_date
    ? new Date(proff.joining_date).toISOString().slice(0, 10)
    : null;
  if (joiningDate && joiningDate !== '0000-00-00' && dateSubmitted < joiningDate) {
    return NextResponse.json({ error: 'Resignation Submitted date cannot be before the employee joining date' }, { status: 400 });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // authorised_to / Comments_to_manager / contact_no are left untouched on edit — none is part
    // of the admin Separation form (they belong to legacy's employee self-service flow) and
    // nothing downstream reads them.
    await connection.execute(
      `UPDATE resignation_requests
       SET Reason = ?, Reason_Desc = ?, applied_date = ?, Last_workingday = ?
       WHERE Resignation_pkey = ?`,
      [body.reason, body.reason_desc ?? '', dateSubmitted, lastWorkingDay, id]
    );

    const [[existingTerm]] = await connection.execute<RowDataPacket[]>(
      'SELECT terminate_pkey FROM termination WHERE Resignation_pkey = ? AND status = 1',
      [id]
    );

    if (existingTerm) {
      await connection.execute(
        `UPDATE termination
         SET Reason = ?, Reason_desc = ?, submitted_date = ?, last_applied_date = ?,
             last_working_date = ?, last_approved_working_date = ?, act_last_working_day = ?,
             notice_period = ?, remarks = ?
         WHERE Resignation_pkey = ? AND status = 1`,
        [
          body.reason, body.reason_desc ?? '', dateSubmitted, lastApplied,
          lastWorkingDay, lastApprovedWd, lastApprovedWd, noticeDays, remarks, id,
        ]
      );
    } else {
      // Some resignation_requests rows predate this app (created directly, not via our own
      // POST /api/resignations, which always creates both rows together) and have no companion
      // termination row at all — create one now, matching the shape POST would have used.
      await connection.execute(
        `INSERT INTO termination
           (emp_fkey, Reason, ed, Reason_desc, is_authorized, authorized_by, is_approved, approved_by,
            submitted_date, last_applied_date, last_working_date, Resignation_pkey,
            last_approved_working_date, notice_period, act_last_working_day, remarks,
            working_days_settled, leave_balance, approved_balance, days_attendance, encashed_days,
            payroll_days, amt_paid_by_empaddition, amt_paid_by_empdeduction, status)
         VALUES (?, ?, ?, ?, 'N', 0, 'N', 0, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 1)`,
        [
          req.emp_fkey, body.reason, lastWorkingDay, body.reason_desc ?? '',
          dateSubmitted, lastApplied, lastWorkingDay, id, lastApprovedWd, noticeDays, lastApprovedWd, remarks,
        ]
      );
    }

    await connection.commit();
    return NextResponse.json({ success: true });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
