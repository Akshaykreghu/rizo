import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// HR-generated documents (offer letters, certificates, etc. produced via
// POST /api/employees/[id]/generate-document) — distinct from the personal
// documents (Aadhaar/passport/visa) served by ../documents/route.ts.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (session.user.userGroup !== 1 && session.user.empFkey !== parseInt(id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT document_pkey, document_name, creation_date, document AS content
     FROM documents
     WHERE emp_fkey = ? AND status = 1
     ORDER BY creation_date DESC`,
    [id]
  );
  return NextResponse.json(rows);
}
