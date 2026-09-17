import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports LeaveEncashmentRequestController's withdraw-a-pending-request behavior (cancel_leave() for
// the employee's own view, cancelentries() for the HR grid's "remove" action — both just take an
// unapproved row out of circulation). Legacy has cancel_leave() soft-delete (status=0) and
// cancelentries() hard-DELETE; this route always soft-deletes since every list query here already
// filters status=1 and soft-delete is non-destructive/reversible for both call sites.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[entry]] = await pool.execute<RowDataPacket[]>(
    `SELECT leave_encashment_master_pkey, emp_fkey, is_approved
     FROM leave_encashment_master WHERE leave_encashment_master_pkey = ?`,
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Encashment request not found' }, { status: 404 });
  if (entry.is_approved === 'Y') {
    return NextResponse.json({ error: 'An approved encashment cannot be cancelled' }, { status: 409 });
  }
  // Employee self-service can only ever cancel their own request.
  if (session.user.userGroup !== 1 && entry.emp_fkey !== session.user.empFkey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await pool.execute(
    `UPDATE leave_encashment_master SET status = 0 WHERE leave_encashment_master_pkey = ?`,
    [id]
  );

  return NextResponse.json({ success: true });
}
