import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports DocumentManagerController::deleteDocumentFromGrid() — refuses to delete a document
// that is still allocated to any employee, rather than silently orphaning those allocations.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[{ count }]] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(DISTINCT emp_fkey) AS count FROM document_allocation WHERE document_upload_fkey = ? AND status = 1',
    [id]
  );
  if (count > 0) {
    return NextResponse.json({ error: 'Document is already allocated to employees' }, { status: 409 });
  }

  await pool.execute('UPDATE document_upload SET status = 0 WHERE document_upload_pkey = ?', [id]);
  return NextResponse.json({ success: true });
}
