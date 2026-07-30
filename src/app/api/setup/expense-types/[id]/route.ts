import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function PUT(
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

  const [dupCode] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM expense_type WHERE expense_type_code = ? AND status = 1 AND expense_type_pkey != ?',
    [body.expense_type_code ?? '', id]
  );
  if (dupCode.length) {
    return NextResponse.json({ error: 'Expense type code already exists' }, { status: 409 });
  }
  const [dupName] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM expense_type WHERE expense_type_name = ? AND status = 1 AND expense_type_pkey != ?',
    [body.expense_type_name, id]
  );
  if (dupName.length) {
    return NextResponse.json({ error: 'Expense type name already exists' }, { status: 409 });
  }

  await pool.execute(
    'UPDATE expense_type SET expense_type_code = ?, expense_type_name = ?, modified_by = ?, modified_date = NOW() WHERE expense_type_pkey = ?',
    [body.expense_type_code ?? '', body.expense_type_name, session.user.loginUserId, id]
  );
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  await pool.execute('UPDATE expense_type SET status = 0 WHERE expense_type_pkey = ?', [id]);
  return NextResponse.json({ success: true });
}
