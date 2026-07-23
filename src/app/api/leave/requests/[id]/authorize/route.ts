import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { runLeaveTransaction, toISODate } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports grandLeave()'s Authorize branch. Real legacy shortcut ported per project decision: if the same
// employee is configured as both ISAutherizedby and APPROVEDBY, a single Authorize call also flips
// approval and jumps LEAVESTATUS straight to 'Approved' — avoiding a redundant second click.
// Guarded against double-processing (must currently be 'Applied'), same precedent as the Regularisation
// bug fix (legacy's own bulkupdate() lacked this guard).
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
    `SELECT LEAVEENTRYID, EMP_fkey, FROMDATE, FROMHALF, TODATE, TOHALF, leave_days, LEAVESTATUS, ISAutherizedby, APPROVEDBY
     FROM leaveentries WHERE LEAVEENTRYID = ?`,
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
  if (entry.LEAVESTATUS !== 'Applied') {
    return NextResponse.json({ error: `Cannot authorize a request in status '${entry.LEAVESTATUS}'` }, { status: 409 });
  }

  const autoApprove = entry.APPROVEDBY != null && entry.ISAutherizedby === entry.APPROVEDBY;
  const newStatus = autoApprove ? 'Approved' : 'Authorized';

  if (autoApprove) {
    await pool.execute(
      `UPDATE leaveentries
       SET ISAutherized = 1, Autherized_date = CURDATE(), ISAPPROVED = 1, APPROVED_date = CURDATE(),
           LEAVESTATUS = 'Approved', AuthoriseRemarks = ?, ApproveRemarks = ?
       WHERE LEAVEENTRYID = ?`,
      [remarks, remarks, id]
    );
  } else {
    await pool.execute(
      `UPDATE leaveentries
       SET ISAutherized = 1, Autherized_date = CURDATE(), LEAVESTATUS = 'Authorized', AuthoriseRemarks = ?
       WHERE LEAVEENTRYID = ?`,
      [remarks, id]
    );
  }

  const { finalStatus, errorMessage } = await runLeaveTransaction(pool, {
    leaveEntryId: entry.LEAVEENTRYID, empFkey: entry.EMP_fkey, fromDate: toISODate(entry.FROMDATE),
    fromHalf: entry.FROMHALF, toDate: toISODate(entry.TODATE), toHalf: entry.TOHALF,
    leaveDays: Number(entry.leave_days), status: newStatus,
  });

  return NextResponse.json({ success: true, status: finalStatus, autoApproved: autoApprove, procMessage: errorMessage });
}
