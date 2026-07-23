import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Legacy's "Document Upload" is a tab embedded on the employee profile, not a standalone
// page — it writes to emp_passport_visa (keyed directly by emp_fkey), a separate table from
// emp_documents (which is the pre-onboarding Employee Join staging table). Onboarding already
// copies staged emp_documents rows into emp_passport_visa; this route manages that same table
// going forward for an already-onboarded employee.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_passport_visa_pkey, document_type, document_number, name, relation,
            nationality, valid_from, valid_till, remarks, files
     FROM emp_passport_visa
     WHERE emp_fkey = ? AND status = 1
     ORDER BY emp_passport_visa_pkey DESC`,
    [id]
  );
  return NextResponse.json(rows);
}

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
  const pool = await getCompanyPool(session.user.companyCode);

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO emp_passport_visa
       (emp_fkey, document_type, document_number, classification, name, relation,
        valid_from, valid_till, nationality, remarks, files, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      id, body.document_type, body.document_number, body.classification ?? null,
      body.name, body.relation, body.valid_from, body.valid_till ?? null,
      body.nationality, body.remarks ?? null, body.files ?? null,
      session.user.loginUserId,
    ]
  );

  return NextResponse.json({ emp_passport_visa_pkey: result.insertId }, { status: 201 });
}
