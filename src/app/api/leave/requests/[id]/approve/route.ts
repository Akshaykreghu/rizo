import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { attendancePunchConflictMessage, checkAttendancePunches, checkAttendanceRegisterRangeVerified, isLeaveTransactionFailure, runLeaveTransaction, toISODate } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports grandLeave()'s Approve branch. Normally must currently be 'Authorized' (a request whose
// authorizer and approver are the same person never reaches this state — it's auto-approved by the
// authorize route). Admin gets a shortcut: an admin may approve directly from 'Applied' too, skipping
// the Authorize step entirely — the UI only ever offers admins Approve/Cancel, never Authorize.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const remarks = (body as { remarks?: string }).remarks ?? null;

  const pool = await getCompanyPool(session.user.companyCode);

  const [[entry]] = await pool.execute<RowDataPacket[]>(
    `SELECT LEAVEENTRYID, EMP_fkey, FROMDATE, FROMHALF, TODATE, TOHALF, leave_days, LEAVESTATUS, APPROVEDBY
     FROM leaveentries WHERE LEAVEENTRYID = ?`,
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
  const isAdmin = session.user.userGroup === 1;
  // Only admin or the designated approver for this specific request may approve it.
  if (!isAdmin && session.user.empFkey !== entry.APPROVEDBY) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const skippingAuthorize = isAdmin && entry.LEAVESTATUS === 'Applied';
  if (entry.LEAVESTATUS !== 'Authorized' && !skippingAuthorize) {
    return NextResponse.json({ error: `Cannot approve a request in status '${entry.LEAVESTATUS}'` }, { status: 409 });
  }

  const fromDate = toISODate(entry.FROMDATE);
  const toDate = toISODate(entry.TODATE);
  // Ported from grandLeave()'s criterias() call, gated exactly as legacy does — only when the
  // leave is currently 'Applied' (controller.php:2374-2384; approving from 'Authorized' does not
  // re-run this check in legacy).
  if (skippingAuthorize) {
    const attendanceVerifiedConflict = await checkAttendanceRegisterRangeVerified(pool, entry.EMP_fkey, fromDate, toDate);
    if (attendanceVerifiedConflict) return NextResponse.json({ error: attendanceVerifiedConflict }, { status: 409 });
    const conflictMask = await checkAttendancePunches(pool, entry.EMP_fkey, fromDate, toDate, entry.FROMHALF, entry.TOHALF);
    if (conflictMask) {
      return NextResponse.json({ error: attendancePunchConflictMessage(conflictMask, 'save') }, { status: 409 });
    }
  }

  await pool.execute(
    `UPDATE leaveentries SET
       ISAutherized = ${skippingAuthorize ? '1' : 'ISAutherized'},
       Autherized_date = ${skippingAuthorize ? 'CURDATE()' : 'Autherized_date'},
       ISAPPROVED = 1, APPROVED_date = CURDATE(), LEAVESTATUS = 'Approved', ApproveRemarks = ?
     WHERE LEAVEENTRYID = ?`,
    [remarks, id]
  );

  const { finalStatus, errorMessage } = await runLeaveTransaction(pool, {
    leaveEntryId: entry.LEAVEENTRYID, empFkey: entry.EMP_fkey, fromDate,
    fromHalf: entry.FROMHALF, toDate, toHalf: entry.TOHALF,
    leaveDays: Number(entry.leave_days), status: 'Approved',
  });

  if (isLeaveTransactionFailure(finalStatus)) {
    return NextResponse.json({ error: errorMessage || finalStatus }, { status: 409 });
  }

  return NextResponse.json({ success: true, status: finalStatus, procMessage: errorMessage });
}
