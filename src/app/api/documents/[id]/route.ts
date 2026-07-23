import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  const [[row]] = await pool.execute<RowDataPacket[]>(
    'SELECT document_pkey, document_name, document FROM documents WHERE document_pkey = ? AND status = 1',
    [id]
  );
  if (!row) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  return NextResponse.json(row);
}
