import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, rowId } = await params;
  if (session.user.userGroup !== 1 && session.user.empFkey !== parseInt(id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  // Soft delete (status=0), matching the emp_family convention — legacy has no remove action for
  // history at all, but leaving no way to correct a mis-entered row isn't worth replicating.
  await pool.execute(
    'UPDATE history SET status = 0 WHERE history_pkey = ? AND emp_fkey = ?',
    [rowId, id]
  );

  return NextResponse.json({ success: true });
}
