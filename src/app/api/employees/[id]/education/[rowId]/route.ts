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
  if (session.user.userGroup !== 1 && session.user.empFkey !== parseInt(id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const locked = await selfEditLockedResponse(pool, session, parseInt(id));
  if (locked) return locked;

  // Soft delete (status=0), matching the emp_family convention — legacy has no remove action for
  // qualifcations at all, but leaving no way to correct a mis-entered row isn't worth replicating.
  await pool.execute(
    'UPDATE qualifcations SET status = 0 WHERE qualification_pkey = ? AND emp_fkey = ?',
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
  const rowError = childRowError('education', body);
  if (rowError) return NextResponse.json({ error: rowError }, { status: 400 });
  const pool = await getCompanyPool(session.user.companyCode);
  const locked = await selfEditLockedResponse(pool, session, parseInt(id));
  if (locked) return locked;

  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE qualifcations SET course = ?, university = ?, duration = ?, mark = ?
     WHERE qualification_pkey = ? AND emp_fkey = ?`,
    [
      body.degree, body.university, body.duration, body.marks, rowId, id,
    ]
  );

  if (result.affectedRows === 0) return NextResponse.json({ error: 'Row not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
