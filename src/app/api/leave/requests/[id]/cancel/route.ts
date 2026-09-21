import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { isLeaveTransactionFailure, runLeaveTransaction, toISODate } from '@/lib/leave';
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
// - Employee cancelling their own 'Authorized'/'Approved' leave still raises a pending-review
//   cancellation (see .../cancellation/approve and .../cancellation/reject) since someone else
//   already signed off on it.
// - Admin never goes through that review step at all, regardless of the leave's current status —
//   an admin cancellation is a final decision by definition, so it always lands directly on
//   'CancelledByAdmin' by project decision.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
  // Only admin or the leave's own owner may cancel it.
  if (session.user.userGroup !== 1 && session.user.empFkey !== entry.EMP_fkey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isAdmin = session.user.userGroup === 1;
  // Admin cancellation is always a direct, final decision — no pending-review step, regardless of
  // whether the leave is Applied, Authorized, or Approved. Only a non-admin (employee) cancelling
  // their own already-authorized/approved leave goes through the review flow.
  const isAdminDirectCancel = isAdmin;

  let newStatus: string;
  if (entry.LEAVESTATUS === 'Applied') {
    newStatus = 'Cancelled';
  } else if (entry.LEAVESTATUS === 'Authorized') {
    newStatus = isAdmin ? 'Cancelled' : 'CancellationOfAuthorized';
  } else if (entry.LEAVESTATUS === 'Approved') {
    newStatus = isAdmin ? 'Cancelled' : 'CancellationOfApproved';
  } else {
    return NextResponse.json({ error: `Cannot cancel a request in status '${entry.LEAVESTATUS}'` }, { status: 409 });
  }

  await pool.execute(
    `UPDATE leaveentries SET LEAVESTATUS = ?, REMARKS = ? WHERE LEAVEENTRYID = ?`,
    [newStatus, reason, id]
  );

  const { finalStatus: procFinalStatus, errorMessage } = await runLeaveTransaction(pool, {
    leaveEntryId: entry.LEAVEENTRYID, empFkey: entry.EMP_fkey, fromDate: toISODate(entry.FROMDATE),
    fromHalf: entry.FROMHALF, toDate: toISODate(entry.TODATE), toHalf: entry.TOHALF,
    leaveDays: Number(entry.leave_days), status: newStatus,
  });

  if (isLeaveTransactionFailure(procFinalStatus)) {
    return NextResponse.json({ error: errorMessage || procFinalStatus }, { status: 409 });
  }

  // leave_transaction_prc only recognizes legacy's real status names (no 'CancelledByAdmin'
  // branch exists in it) — run the transaction as 'Cancelled' so its balance-restoration/cleanup
  // logic actually executes, then relabel the row afterwards for admin-initiated cancellations.
  let finalStatus = procFinalStatus;
  if (isAdminDirectCancel) {
    finalStatus = 'CancelledByAdmin';
    await pool.execute(`UPDATE leaveentries SET LEAVESTATUS = 'CancelledByAdmin' WHERE LEAVEENTRYID = ?`, [id]);
  }

  return NextResponse.json({
    success: true,
    status: finalStatus,
    requiresReview: newStatus !== 'Cancelled',
    procMessage: errorMessage,
  });
}
