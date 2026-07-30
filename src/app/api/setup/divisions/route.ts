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
    'SELECT id, div_code, div_name FROM division WHERE status = 1 ORDER BY div_name'
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
    'SELECT 1 FROM division WHERE div_code = ? AND status = 1',
    [body.div_code ?? '']
  );
  if (dupCode.length) {
    return NextResponse.json({ error: 'Division code already exists' }, { status: 409 });
  }
  const [dupName] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM division WHERE div_name = ? AND status = 1',
    [body.div_name]
  );
  if (dupName.length) {
    return NextResponse.json({ error: 'Division name already exists' }, { status: 409 });
  }

  const [result] = await pool.execute<ResultSetHeader>(
    'INSERT INTO division (div_code, div_name, status) VALUES (?, ?, 1)',
    [body.div_code ?? '', body.div_name]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
