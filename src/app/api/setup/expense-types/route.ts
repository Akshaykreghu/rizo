import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT expense_type_pkey, expense_type_code, expense_type_name, status FROM expense_type WHERE status = 1 ORDER BY expense_type_name'
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);

  const [dupCode] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM expense_type WHERE expense_type_code = ? AND status = 1',
    [body.expense_type_code ?? '']
  );
  if (dupCode.length) {
    return NextResponse.json({ error: 'Expense type code already exists' }, { status: 409 });
  }
  const [dupName] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM expense_type WHERE expense_type_name = ? AND status = 1',
    [body.expense_type_name]
  );
  if (dupName.length) {
    return NextResponse.json({ error: 'Expense type name already exists' }, { status: 409 });
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO expense_type (expense_type_code, expense_type_name, expense_head_fkey, created_by, creation_date, status)
     VALUES (?, ?, 0, ?, NOW(), 1)`,
    [body.expense_type_code ?? '', body.expense_type_name, session.user.loginUserId]
  );
  return NextResponse.json({ expense_type_pkey: result.insertId }, { status: 201 });
}
