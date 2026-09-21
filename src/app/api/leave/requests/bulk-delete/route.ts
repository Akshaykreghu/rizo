import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports LeaveRequestController::deleteLeaveRequests() (controller.php:2860-2877) — legacy's own
// grid only ever calls this with a single selected row (singleSelect: true, getSelected()), so
// its handler string-concats `LEAVEENTRYID = '$ids'` and never actually needed to support a
// comma-joined id list. This bulk version fixes that generalization (loop + real deletion per id)
// while keeping legacy's own status gate verbatim, taken from index.ctp's "Remove" handler:
//   - Approved/Authorized leaves cannot be removed ("You Cannot remove Approved/Authorized Leaves")
//   - CancellationOfApproved cannot be removed either ("You Cannot remove the leave before Approval
//     of Cancellation")
// Everything else (Applied, Rejected, Cancelled, CancellationOfAuthorized, etc.) is a real hard
// delete — legacy deletes emp_leave_transactions rows for the entry, then the leaveentries row
// itself; no soft-delete flag exists for this action.
//
// Self-service scoped: an employee can only ever delete their OWN leave requests, never an
// arbitrary LEAVEENTRYID — legacy's controller has no such check (any authenticated session could
// pass any id), which we don't reproduce since it's a real authorization gap, not a documented
// legacy behavior worth matching.
const BLOCKED_STATUSES: Record<string, string> = {
  Approved: 'Cannot remove an Approved leave request',
  Authorized: 'Cannot remove an Authorized leave request',
  CancellationOfApproved: 'Cannot remove a leave pending approval of cancellation',
};

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const ids = (body as { ids?: number[] }).ids ?? [];
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids is required' }, { status: 400 });
  }

  const isAdmin = session.user.userGroup === 1;
  const pool = await getCompanyPool(session.user.companyCode);

  const deleted: number[] = [];
  const skipped: { id: number; reason: string }[] = [];

  for (const id of ids) {
    const [[entry]] = await pool.execute<RowDataPacket[]>(
      'SELECT LEAVEENTRYID, EMP_fkey, LEAVESTATUS FROM leaveentries WHERE LEAVEENTRYID = ?',
      [id]
    );
    if (!entry) {
      skipped.push({ id, reason: 'Not found' });
      continue;
    }
    if (!isAdmin && entry.EMP_fkey !== session.user.empFkey) {
      skipped.push({ id, reason: 'Not your leave request' });
      continue;
    }
    const blockReason = BLOCKED_STATUSES[entry.LEAVESTATUS];
    if (blockReason) {
      skipped.push({ id, reason: blockReason });
      continue;
    }

    await pool.execute('DELETE FROM emp_leave_transactions WHERE LEAVEENTRYID = ?', [id]);
    await pool.execute('DELETE FROM leaveentries WHERE LEAVEENTRYID = ?', [id]);
    deleted.push(id);
  }

  return NextResponse.json({ success: true, deleted, skipped });
}
