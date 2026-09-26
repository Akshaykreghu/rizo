import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { checkAttendanceRegisterRangeVerified, runLeaveTransaction, toISODate } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Bulk counterpart of .../[id]/cancel — mirrors EmployeeLeavesController::deleteleave()'s
// checkbox-grid bulk action (which always sets 'CancelledByAdmin', matching our single-row admin
// cancel), plus the same new attendance-verified safeguard as bulk-approve: a row whose month is
// already attendance-verified is skipped rather than cancelled, and reported back.
//
// A row already in CancellationOfApproved/CancellationOfAuthorized (an employee-initiated pending
// cancellation awaiting review) is routed to the SAME transition .../cancellation/reject uses
// (revert to Approved/Authorized), not deleteleave()'s literal unconditional 'CancelledByAdmin' —
// same reasoning as bulk-approve's own carve-out: on a pending cancellation, admin's "Cancel" button
// means "keep the leave active, decline the cancellation," matching the hierarchy reviewer's own
// Keep Leave action (project decision, 2026-09-26), not a second, contradictory way to end the leave.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const ids = (body as { ids?: number[] }).ids ?? [];
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const cancelled: number[] = [];
  const skipped: { id: number; employeeName: string; reason: string }[] = [];

  for (const id of ids) {
    const [[entry]] = await pool.execute<RowDataPacket[]>(
      `SELECT le.LEAVEENTRYID, le.EMP_fkey, le.FROMDATE, le.FROMHALF, le.TODATE, le.TOHALF, le.leave_days, le.LEAVESTATUS,
              CONCAT(ed.first_name, ' ', ed.last_name) AS employee_name
       FROM leaveentries le
       JOIN emp_details ed ON ed.emp_pkey = le.EMP_fkey
       WHERE le.LEAVEENTRYID = ?`,
      [id]
    );
    if (!entry) {
      skipped.push({ id, employeeName: '', reason: 'Not found' });
      continue;
    }
    const employeeName = (entry.employee_name ?? '').trim();

    const fromDate = toISODate(entry.FROMDATE);
    const toDate = toISODate(entry.TODATE);
    const attendanceBlock = await checkAttendanceRegisterRangeVerified(pool, entry.EMP_fkey, fromDate, toDate);
    if (attendanceBlock) {
      skipped.push({ id, employeeName, reason: attendanceBlock });
      continue;
    }

    const isPendingCancellation = entry.LEAVESTATUS === 'CancellationOfApproved' || entry.LEAVESTATUS === 'CancellationOfAuthorized';

    if (isPendingCancellation) {
      const revertTo = entry.LEAVESTATUS === 'CancellationOfAuthorized' ? 'Authorized' : 'Approved';
      await pool.execute(`UPDATE leaveentries SET LEAVESTATUS = ? WHERE LEAVEENTRYID = ?`, [revertTo, id]);
      await runLeaveTransaction(pool, {
        leaveEntryId: entry.LEAVEENTRYID, empFkey: entry.EMP_fkey, fromDate,
        fromHalf: entry.FROMHALF, toDate, toHalf: entry.TOHALF,
        leaveDays: Number(entry.leave_days), status: revertTo,
      });
    } else {
      await pool.execute(`UPDATE leaveentries SET LEAVESTATUS = 'Cancelled' WHERE LEAVEENTRYID = ?`, [id]);

      // leave_transaction_prc only recognizes legacy's real status names — run it as 'Cancelled' so
      // its balance-restoration/cleanup logic executes, then relabel for the admin-cancel outcome.
      await runLeaveTransaction(pool, {
        leaveEntryId: entry.LEAVEENTRYID, empFkey: entry.EMP_fkey, fromDate,
        fromHalf: entry.FROMHALF, toDate, toHalf: entry.TOHALF,
        leaveDays: Number(entry.leave_days), status: 'Cancelled',
      });
      await pool.execute(`UPDATE leaveentries SET LEAVESTATUS = 'CancelledByAdmin' WHERE LEAVEENTRYID = ?`, [id]);
    }

    cancelled.push(id);
  }

  return NextResponse.json({ success: true, cancelled, skipped });
}
