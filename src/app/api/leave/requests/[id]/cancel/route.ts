import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { runLeaveTransaction, toISODate } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports LeaveRequestController's cancellation-initiation branches (saveLeaveEntry's
// myLeaveAction 'Cancelled' / 'Cancellation Applied'). Simplified against legacy's own source:
// legacy has two parallel, inconsistently-named cancellation status pairs
// (CancellationOfAuthorized/CancellationOfApproved vs. "Cancellation Authorized"/"Cancellation
// Approved" with a space) that overlap in confusing, seemingly-dead-code ways (mixed developer
// edits, commented-out branches). This port uses only the first pair, which the stored proc
// unambiguously recognizes (`leave_transaction_prc` and its balance-window queries both key off
// 'CancellationOfAuthorized'/'CancellationOfApproved'/'Cancelled') — a deliberate simplification
// of a confusing legacy state machine, not a literal port of both parallel paths.
//
// - From 'Applied' (never authorized yet): cancels immediately, no review needed.
// - From 'Authorized' or 'Approved': raises a cancellation request pending review
//   (see .../cancellation/approve and .../cancellation/reject).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reason = (body as { reason?: string }).reason ?? null;

  const pool = await getCompanyPool(session.user.companyCode);

  const [[entry]] = await pool.execute<RowDataPacket[]>(
    `SELECT LEAVEENTRYID, EMP_fkey, FROMDATE, FROMHALF, TODATE, TOHALF, leave_days, LEAVESTATUS
     FROM leaveentries WHERE LEAVEENTRYID = ?`,
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });

  let newStatus: string;
  if (entry.LEAVESTATUS === 'Applied') {
    newStatus = 'Cancelled';
  } else if (entry.LEAVESTATUS === 'Authorized') {
    newStatus = 'CancellationOfAuthorized';
  } else if (entry.LEAVESTATUS === 'Approved') {
    newStatus = 'CancellationOfApproved';
  } else {
    return NextResponse.json({ error: `Cannot cancel a request in status '${entry.LEAVESTATUS}'` }, { status: 409 });
  }

  await pool.execute(
    `UPDATE leaveentries SET LEAVESTATUS = ?, REMARKS = ? WHERE LEAVEENTRYID = ?`,
    [newStatus, reason, id]
  );

  const { finalStatus, errorMessage } = await runLeaveTransaction(pool, {
    leaveEntryId: entry.LEAVEENTRYID, empFkey: entry.EMP_fkey, fromDate: toISODate(entry.FROMDATE),
    fromHalf: entry.FROMHALF, toDate: toISODate(entry.TODATE), toHalf: entry.TOHALF,
    leaveDays: Number(entry.leave_days), status: newStatus,
  });

  return NextResponse.json({
    success: true,
    status: finalStatus,
    requiresReview: newStatus !== 'Cancelled',
    procMessage: errorMessage,
  });
}
