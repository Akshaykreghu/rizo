import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { isLeaveTransactionFailure, runLeaveTransaction, toISODate } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Rejects a pending cancellation request — reverts to the pre-cancellation status
// (CancellationOfAuthorized -> Authorized, CancellationOfApproved -> Approved). Same reviewer
// gate as .../cancellation/approve (see comment there): legacy's grandLeave() 'Reject' branch has
// no admin-role check, only ISAutherizedby/APPROVEDBY == session emp_fkey.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[entry]] = await pool.execute<RowDataPacket[]>(
    `SELECT LEAVEENTRYID, EMP_fkey, FROMDATE, FROMHALF, TODATE, TOHALF, leave_days, LEAVESTATUS, ISAutherizedby, APPROVEDBY
     FROM leaveentries WHERE LEAVEENTRYID = ?`,
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });

  const revertTo = entry.LEAVESTATUS === 'CancellationOfAuthorized' ? 'Authorized'
    : entry.LEAVESTATUS === 'CancellationOfApproved' ? 'Approved' : null;
  if (!revertTo) {
    return NextResponse.json({ error: `No pending cancellation request for status '${entry.LEAVESTATUS}'` }, { status: 409 });
  }
  const isAdmin = session.user.userGroup === 1;
  const responsibleActor = entry.LEAVESTATUS === 'CancellationOfAuthorized' ? entry.ISAutherizedby : entry.APPROVEDBY;
  if (!isAdmin && session.user.empFkey !== responsibleActor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await pool.execute(`UPDATE leaveentries SET LEAVESTATUS = ? WHERE LEAVEENTRYID = ?`, [revertTo, id]);

  const { finalStatus, errorMessage } = await runLeaveTransaction(pool, {
    leaveEntryId: entry.LEAVEENTRYID, empFkey: entry.EMP_fkey, fromDate: toISODate(entry.FROMDATE),
    fromHalf: entry.FROMHALF, toDate: toISODate(entry.TODATE), toHalf: entry.TOHALF,
    leaveDays: Number(entry.leave_days), status: revertTo,
  });

  if (isLeaveTransactionFailure(finalStatus)) {
    return NextResponse.json({ error: errorMessage || finalStatus }, { status: 409 });
  }

  return NextResponse.json({ success: true, status: finalStatus, procMessage: errorMessage });
}
