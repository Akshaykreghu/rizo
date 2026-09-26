import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Content fetch for one HR policy document — scoped to policy = 1 so this session-only (not
// admin-only) route can never be used to read an employee's private allocated document by guessing
// its id; see policies/route.ts for the listing this backs.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  const [[row]] = await pool.execute<RowDataPacket[]>(
    'SELECT document_pkey, document_name, document FROM documents WHERE document_pkey = ? AND policy = 1 AND status = 1',
    [id]
  );
  if (!row) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  return NextResponse.json(row);
}
