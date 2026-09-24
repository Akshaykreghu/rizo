import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Employee cancels their own not-yet-decided request. Mirrors DELETE /api/expenses/[id]'s
// scoping + "locked once settled" convention.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[entry]] = await pool.execute<RowDataPacket[]>(
    'SELECT request_pkey, emp_fkey, status FROM emp_asset_request WHERE request_pkey = ? AND active = 1',
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (session.user.userGroup !== 1 && session.user.empFkey !== entry.emp_fkey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (entry.status !== 'Pending') {
    return NextResponse.json({ error: 'Cannot cancel a request that has already been decided' }, { status: 409 });
  }

  await pool.execute(
    `UPDATE emp_asset_request SET status = 'Cancelled', active = 0 WHERE request_pkey = ?`,
    [id]
  );
  return NextResponse.json({ success: true });
}
