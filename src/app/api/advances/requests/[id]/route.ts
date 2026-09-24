import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Withdraw a still-Pending request. Mirrors DELETE /api/advances/[id]'s ownership carve-out (owner
// or admin), but blocks on request_status rather than is_credited — once a request has been
// Approved or Rejected it's a settled record, not something either side should be able to erase.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[entry]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_advance_request_pkey, emp_fkey, request_status FROM emp_advance_request WHERE emp_advance_request_pkey = ? AND status = 1',
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (session.user.userGroup !== 1 && session.user.empFkey !== entry.emp_fkey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (entry.request_status !== 'Pending') {
    return NextResponse.json({ error: `Cannot withdraw a request in status '${entry.request_status}'` }, { status: 409 });
  }

  await pool.execute('UPDATE emp_advance_request SET status = 0 WHERE emp_advance_request_pkey = ?', [id]);
  return NextResponse.json({ success: true });
}
