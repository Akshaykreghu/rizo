import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';
import { childRowError } from '@/lib/childRowValidation';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, rowId } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  await pool.execute(
    'DELETE FROM work_experience WHERE experience_pkey = ? AND emp_join_fkey = ?',
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
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, rowId } = await params;
  const body = await request.json();
  const rowError = childRowError('experience', body);
  if (rowError) return NextResponse.json({ error: rowError }, { status: 400 });
  const pool = await getCompanyPool(session.user.companyCode);

  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE work_experience
     SET company = ?, from_date = ?, to_date = ?, designation = ?, department = ?, salary = ?
     WHERE experience_pkey = ? AND emp_join_fkey = ?`,
    [
      body.company, body.from_date, body.to_date, body.designation, body.department,
      body.salary ? Number(body.salary) : null, rowId, id,
    ]
  );

  if (result.affectedRows === 0) return NextResponse.json({ error: 'Row not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
