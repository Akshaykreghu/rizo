import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { runLeaveTransaction, toISODate } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports grandLeave()'s Approve branch. Must currently be 'Authorized' (a request whose authorizer and
// approver are the same person never reaches this state — it's auto-approved by the authorize route).
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
  const remarks = (body as { remarks?: string }).remarks ?? null;

  const pool = await getCompanyPool(session.user.companyCode);

  const [[entry]] = await pool.execute<RowDataPacket[]>(
    `SELECT LEAVEENTRYID, EMP_fkey, FROMDATE, FROMHALF, TODATE, TOHALF, leave_days, LEAVESTATUS
     FROM leaveentries WHERE LEAVEENTRYID = ?`,
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
  if (entry.LEAVESTATUS !== 'Authorized') {
    return NextResponse.json({ error: `Cannot approve a request in status '${entry.LEAVESTATUS}'` }, { status: 409 });
  }

  await pool.execute(
    `UPDATE leaveentries SET ISAPPROVED = 1, APPROVED_date = CURDATE(), LEAVESTATUS = 'Approved', ApproveRemarks = ?
     WHERE LEAVEENTRYID = ?`,
    [remarks, id]
  );

  const { finalStatus, errorMessage } = await runLeaveTransaction(pool, {
    leaveEntryId: entry.LEAVEENTRYID, empFkey: entry.EMP_fkey, fromDate: toISODate(entry.FROMDATE),
    fromHalf: entry.FROMHALF, toDate: toISODate(entry.TODATE), toHalf: entry.TOHALF,
    leaveDays: Number(entry.leave_days), status: 'Approved',
  });

  return NextResponse.json({ success: true, status: finalStatus, procMessage: errorMessage });
}
