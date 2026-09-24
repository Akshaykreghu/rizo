import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { selfEditLockedResponse } from '@/lib/employeeEditLock';
import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';
import { childRowError } from '@/lib/childRowValidation';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, docId } = await params;
  // Employees can remove their own documents (matches GET /api/employees/[id]/documents).
  if (session.user.userGroup !== 1 && session.user.empFkey !== parseInt(id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const locked = await selfEditLockedResponse(pool, session, parseInt(id));
  if (locked) return locked;

  // Soft delete (status=0): emp_passport_visa is the permanent, post-onboarding record,
  // unlike the staging emp_documents table which is hard-deleted on discard.
  await pool.execute(
    'UPDATE emp_passport_visa SET status = 0 WHERE emp_passport_visa_pkey = ? AND emp_fkey = ?',
    [docId, id]
  );

  return NextResponse.json({ success: true });
}

// Edit updates the existing row in place (same row id) — the same columns the POST on the
// parent route writes.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, docId } = await params;
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
    `UPDATE emp_passport_visa
     SET document_type = ?, document_number = ?, name = ?, relation = ?, nationality = ?,
         valid_from = ?, valid_till = ?, files = ?,
         classification = COALESCE(?, classification) -- only the ESS form sends it; admin edits keep it
     WHERE emp_passport_visa_pkey = ? AND emp_fkey = ?`,
    [
      body.document_type, body.document_number, body.name, body.relation, body.nationality ?? null,
      body.valid_from, body.valid_till || null, body.files || null, body.classification || null, docId, id,
    ]
  );

  if (result.affectedRows === 0) return NextResponse.json({ error: 'Row not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
