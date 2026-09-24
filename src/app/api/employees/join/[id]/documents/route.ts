import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';
import { childRowError } from '@/lib/childRowValidation';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const rowError = childRowError('documents', body);
  if (rowError) return NextResponse.json({ error: rowError }, { status: 400 });
  const pool = await getCompanyPool(session.user.companyCode);

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO emp_documents
       (emp_join_fkey, document_type, document_number, classification, name, relation,
        valid_from, valid_till, nationality, remarks, files, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      id, body.document_type, body.document_number, body.classification ?? null,
      body.name, body.relation, body.valid_from, body.valid_till || null, // optional — the form sends '' when blank, which MySQL rejects for a DATE
      body.nationality, body.remarks ?? null, body.files ?? null,
      session.user.loginUserId,
    ]
  );

  return NextResponse.json({ emp_doc_pkey: result.insertId }, { status: 201 });
}
