import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { isLeaveTransactionFailure, runLeaveTransaction, toISODate } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports grandLeave()'s Reject branch — callable from either 'Applied' or 'Authorized' (no balance
// check on reject, matching legacy).
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
    `SELECT LEAVEENTRYID, EMP_fkey, FROMDATE, FROMHALF, TODATE, TOHALF, leave_days, LEAVESTATUS, ISAutherizedby, APPROVEDBY
     FROM leaveentries WHERE LEAVEENTRYID = ?`,
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
  // Only admin, the designated authorizer, or the designated approver may reject.
  if (session.user.userGroup !== 1 && session.user.empFkey !== entry.ISAutherizedby && session.user.empFkey !== entry.APPROVEDBY) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (entry.LEAVESTATUS !== 'Applied' && entry.LEAVESTATUS !== 'Authorized') {
    return NextResponse.json({ error: `Cannot reject a request in status '${entry.LEAVESTATUS}'` }, { status: 409 });
  }

  // Ported from grandLeave()'s plain-Reject branch (controller.php:2712-2723): stamps
  // Autherized_date when rejecting from 'Applied', otherwise APPROVED_date — and always stamps
  // APPROVED_date when the same person is both authorizer and approver for this request.
  const sameActor = entry.ISAutherizedby != null && entry.ISAutherizedby === entry.APPROVEDBY;
  const stampAuthorizedDate = entry.LEAVESTATUS === 'Applied';
  await pool.execute(
    `UPDATE leaveentries SET
       LEAVESTATUS = 'Rejected', REMARKS = ?,
       Autherized_date = ${stampAuthorizedDate ? 'CURDATE()' : 'Autherized_date'},
       APPROVED_date = ${!stampAuthorizedDate || sameActor ? 'CURDATE()' : 'APPROVED_date'}
     WHERE LEAVEENTRYID = ?`,
    [remarks, id]
  );

  const { finalStatus, errorMessage } = await runLeaveTransaction(pool, {
    leaveEntryId: entry.LEAVEENTRYID, empFkey: entry.EMP_fkey, fromDate: toISODate(entry.FROMDATE),
    fromHalf: entry.FROMHALF, toDate: toISODate(entry.TODATE), toHalf: entry.TOHALF,
    leaveDays: Number(entry.leave_days), status: 'Rejected',
  });

  if (isLeaveTransactionFailure(finalStatus)) {
    return NextResponse.json({ error: errorMessage || finalStatus }, { status: 409 });
  }

  return NextResponse.json({ success: true, status: finalStatus, procMessage: errorMessage });
}
