import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { runLeaveTransaction, toISODate } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Confirms a pending cancellation request (CancellationOfAuthorized/CancellationOfApproved -> Cancelled).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[entry]] = await pool.execute<RowDataPacket[]>(
    `SELECT LEAVEENTRYID, EMP_fkey, FROMDATE, FROMHALF, TODATE, TOHALF, leave_days, LEAVESTATUS
     FROM leaveentries WHERE LEAVEENTRYID = ?`,
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
  if (entry.LEAVESTATUS !== 'CancellationOfAuthorized' && entry.LEAVESTATUS !== 'CancellationOfApproved') {
    return NextResponse.json({ error: `No pending cancellation request for status '${entry.LEAVESTATUS}'` }, { status: 409 });
  }

  await pool.execute(`UPDATE leaveentries SET LEAVESTATUS = 'Cancelled' WHERE LEAVEENTRYID = ?`, [id]);

  const { finalStatus, errorMessage } = await runLeaveTransaction(pool, {
    leaveEntryId: entry.LEAVEENTRYID, empFkey: entry.EMP_fkey, fromDate: toISODate(entry.FROMDATE),
    fromHalf: entry.FROMHALF, toDate: toISODate(entry.TODATE), toHalf: entry.TOHALF,
    leaveDays: Number(entry.leave_days), status: 'Cancelled',
  });

  return NextResponse.json({ success: true, status: finalStatus, procMessage: errorMessage });
}
