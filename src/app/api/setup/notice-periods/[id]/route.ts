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

  const [dupDays] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM notice_period WHERE notice_days = ? AND status = 1 AND notice_pkey != ?',
    [Number(body.notice_days) || 0, id]
  );
  if (dupDays.length) {
    return NextResponse.json({ error: 'A notice period with this many days already exists' }, { status: 409 });
  }
  const [dupDesc] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM notice_period WHERE description = ? AND status = 1 AND notice_pkey != ?',
    [body.description, id]
  );
  if (dupDesc.length) {
    return NextResponse.json({ error: 'A notice period with this description already exists' }, { status: 409 });
  }

  await pool.execute(
    'UPDATE notice_period SET notice_days = ?, description = ? WHERE notice_pkey = ?',
    [Number(body.notice_days) || 0, body.description ?? '', id]
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
  await pool.execute('UPDATE notice_period SET status = 0 WHERE notice_pkey = ?', [id]);
  return NextResponse.json({ success: true });
}
