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
    'SELECT 1 FROM division WHERE div_code = ? AND status = 1 AND id != ?',
    [body.div_code ?? '', id]
  );
  if (dupCode.length) {
    return NextResponse.json({ error: 'Division code already exists' }, { status: 409 });
  }
  const [dupName] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM division WHERE div_name = ? AND status = 1 AND id != ?',
    [body.div_name, id]
  );
  if (dupName.length) {
    return NextResponse.json({ error: 'Division name already exists' }, { status: 409 });
  }

  await pool.execute(
    'UPDATE division SET div_code = ?, div_name = ? WHERE id = ?',
    [body.div_code ?? '', body.div_name, id]
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
  await pool.execute('UPDATE division SET status = 0 WHERE id = ?', [id]);
  return NextResponse.json({ success: true });
}
