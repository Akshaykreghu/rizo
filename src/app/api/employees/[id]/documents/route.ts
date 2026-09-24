import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { selfEditLockedResponse } from '@/lib/employeeEditLock';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { childRowError } from '@/lib/childRowValidation';

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
  // Employees can only view their own documents (matches GET /api/employees/[id]).
  if (session.user.userGroup !== 1 && session.user.empFkey !== parseInt(id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_passport_visa_pkey, document_type, document_number, classification, name, relation,
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
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  // Employees can add their own documents (matches GET /api/employees/[id]/documents).
  if (session.user.userGroup !== 1 && session.user.empFkey !== parseInt(id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const rowError = childRowError('documents', body);
  if (rowError) return NextResponse.json({ error: rowError }, { status: 400 });
  const pool = await getCompanyPool(session.user.companyCode);
  const locked = await selfEditLockedResponse(pool, session, parseInt(id));
  if (locked) return locked;

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO emp_passport_visa
       (emp_fkey, document_type, document_number, classification, name, relation,
        valid_from, valid_till, nationality, remarks, files, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      id, body.document_type, body.document_number, body.classification ?? null,
      body.name, body.relation, body.valid_from, body.valid_till || null, // optional — the form sends '' when blank, which MySQL rejects for a DATE
      body.nationality, body.remarks ?? null, body.files ?? null,
      session.user.loginUserId,
    ]
  );

  return NextResponse.json({ emp_passport_visa_pkey: result.insertId }, { status: 201 });
}
