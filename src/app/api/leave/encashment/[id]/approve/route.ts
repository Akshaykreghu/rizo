import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports LeaveEncashmentRequestController::encashemp() — the real live single-record approval path
// (verifyregisterentries() is the bulk/legacy-scheduler variant, same underlying update+proc call,
// not ported separately since this route already generalizes to any id). approved_by hardcoded to
// '0' matching legacy's own real call site exactly (not the requesting employee's chosen approver).
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
  const approvedDays = (body as { approvedDays?: number }).approvedDays;

  const pool = await getCompanyPool(session.user.companyCode);

  const [[entry]] = await pool.execute<RowDataPacket[]>(
    `SELECT lem.leave_encashment_master_pkey, lem.emp_fkey, lem.is_approved, lem.requested_days, ed.branch_code
     FROM leave_encashment_master lem JOIN emp_details ed ON ed.emp_pkey = lem.emp_fkey
     WHERE lem.leave_encashment_master_pkey = ?`,
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Encashment request not found' }, { status: 404 });
  if (entry.is_approved === 'Y') {
    return NextResponse.json({ error: 'This request has already been approved' }, { status: 409 });
  }

  await pool.execute(
    `UPDATE leave_encashment_master
     SET is_approved = 'Y', approved_by = '0', approved_date = CURDATE(), branch_code = ?,
         modified_by = ?, modified_date = NOW(), approved_days = COALESCE(?, requested_days)
     WHERE leave_encashment_master_pkey = ?`,
    [entry.branch_code, session.user.loginUserId, approvedDays ?? null, id]
  );

  await pool.query('CALL leave_encash_prc(?, ?, ?, ?, @msg)', [
    entry.branch_code, entry.emp_fkey, id, '0',
  ]);
  const [[msgRow]] = await pool.query<RowDataPacket[]>('SELECT @msg AS msg');

  return NextResponse.json({ success: true, procMessage: msgRow?.msg ?? null });
}
