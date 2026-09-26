import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Company-wide HR policy documents — legacy marks these via documents.policy = 1 (see
// DocumentManagersController.php's doc_template save: a template flagged policy=1 auto-inserts a
// documents row with emp_fkey=0, and its ESS document listing includes `doc.policy = 1` alongside
// the employee's own allocated rows). Unlike /api/documents (admin-only, per-employee allocations),
// these are visible to every logged-in employee of the company, so this route only requires a
// session, not userGroup === 1.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT document_pkey, document_name, doc_id, creation_date, created_by
     FROM documents
     WHERE policy = 1 AND status = 1
     ORDER BY document_pkey DESC`
  );
  return NextResponse.json(rows);
}
