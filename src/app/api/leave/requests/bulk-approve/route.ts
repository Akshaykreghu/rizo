import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { checkAttendanceRegisterRangeVerified, runLeaveTransaction, toISODate } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Bulk counterpart of .../[id]/approve — mirrors EmployeeLeavesController::approveleave()'s
// checkbox-grid bulk action, plus a new safeguard legacy itself doesn't enforce there (only its
// single apply/save path checks attendance_register.isdelete='N'): a row whose month is already
// attendance-verified is skipped rather than approved, and reported back rather than silently
// dropped.
//
// A row already in CancellationOfApproved/CancellationOfAuthorized (an employee-initiated pending
// cancellation awaiting review) is routed to the SAME transition .../cancellation/approve uses
// (-> 'Cancelled'), not approveleave()'s literal unconditional 'Approved' — reusing the admin bulk
// "Approve" button to silently dismiss a pending cancellation and land on 'Approved' would make the
// word "Approve" mean opposite things depending on which button happened to be clicked, which is the
// actual bug this project decision fixes (2026-09-26): "Approve" on a pending cancellation always
// means approving that cancellation, consistent with the hierarchy reviewer's own Confirm
// Cancellation action.
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

  const approved: number[] = [];
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
      await pool.execute(`UPDATE leaveentries SET LEAVESTATUS = 'Cancelled' WHERE LEAVEENTRYID = ?`, [id]);
      await runLeaveTransaction(pool, {
        leaveEntryId: entry.LEAVEENTRYID, empFkey: entry.EMP_fkey, fromDate,
        fromHalf: entry.FROMHALF, toDate, toHalf: entry.TOHALF,
        leaveDays: Number(entry.leave_days), status: 'Cancelled',
      });
    } else {
      const skippingAuthorize = entry.LEAVESTATUS === 'Applied';
      await pool.execute(
        `UPDATE leaveentries SET
           ISAutherized = ${skippingAuthorize ? '1' : 'ISAutherized'},
           Autherized_date = ${skippingAuthorize ? 'CURDATE()' : 'Autherized_date'},
           ISAPPROVED = 1, APPROVED_date = CURDATE(), LEAVESTATUS = 'Approved'
         WHERE LEAVEENTRYID = ?`,
        [id]
      );

      await runLeaveTransaction(pool, {
        leaveEntryId: entry.LEAVEENTRYID, empFkey: entry.EMP_fkey, fromDate,
        fromHalf: entry.FROMHALF, toDate, toHalf: entry.TOHALF,
        leaveDays: Number(entry.leave_days), status: 'Approved',
      });
    }

    approved.push(id);
  }

  return NextResponse.json({ success: true, approved, skipped });
}
