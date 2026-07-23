import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, rowId } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  await pool.execute(
    'DELETE FROM emp_documents WHERE emp_doc_pkey = ? AND emp_join_fkey = ?',
    [rowId, id]
  );

  return NextResponse.json({ success: true });
}
