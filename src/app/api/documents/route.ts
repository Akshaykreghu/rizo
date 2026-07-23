import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const { searchParams } = new URL(request.url);
  const empFkey = searchParams.get('emp_fkey');

  const conditions = ['doc.status = 1'];
  const sqlParams: string[] = [];
  if (empFkey) {
    conditions.push('doc.emp_fkey = ?');
    sqlParams.push(empFkey);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT doc.document_pkey, doc.document_name, doc.doc_id, doc.creation_date, doc.created_by,
            e.first_name, e.last_name, e.emp_id
     FROM documents doc
     LEFT JOIN emp_details e ON e.emp_pkey = doc.emp_fkey
     WHERE ${conditions.join(' AND ')}
     ORDER BY doc.document_pkey DESC
     LIMIT 100`,
    sqlParams
  );
  return NextResponse.json(rows);
}
