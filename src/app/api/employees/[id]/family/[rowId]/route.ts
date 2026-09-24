import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { selfEditLockedResponse } from '@/lib/employeeEditLock';
import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';
import { childRowError } from '@/lib/childRowValidation';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, rowId } = await params;
  // Employees can remove their own family members (matches GET /api/employees/[id]/family).
  if (session.user.userGroup !== 1 && session.user.empFkey !== parseInt(id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const locked = await selfEditLockedResponse(pool, session, parseInt(id));
  if (locked) return locked;

  // Soft delete (status=0): emp_family is the permanent, post-onboarding record, unlike the
  // staging `family` table (Join flow) which is hard-deleted on discard.
  await pool.execute(
    'UPDATE emp_family SET status = 0 WHERE emp_family_pkey = ? AND emp_fkey = ?',
    [rowId, id]
  );

  return NextResponse.json({ success: true });
}

// Edit updates the existing row in place (same row id) — the same columns the POST on the
// parent route writes.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, rowId } = await params;
  if (session.user.userGroup !== 1 && session.user.empFkey !== parseInt(id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await request.json();
  const rowError = childRowError('family', body);
  if (rowError) return NextResponse.json({ error: rowError }, { status: 400 });
  const pool = await getCompanyPool(session.user.companyCode);
  const locked = await selfEditLockedResponse(pool, session, parseInt(id));
  if (locked) return locked;

  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE emp_family
     SET name = ?, DOB = ?, gender = ?, blood_group = ?, relation = ?, nationality = ?,
         contact_number = ?, alternate_number = ?, emergency_contact = ?, remarks = ?, is_nominee = ?
     WHERE emp_family_pkey = ? AND emp_fkey = ?`,
    [
      body.name, body.DOB || null, body.gender ?? null, body.blood_group ?? null, body.relation ?? null,
      body.nationality ?? '', body.contact_number ?? null, body.alternate_number ?? null,
      body.emergency_contact ?? 'N', body.remarks ?? null, body.is_nominee ?? 'N', rowId, id,
    ]
  );

  if (result.affectedRows === 0) return NextResponse.json({ error: 'Row not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
