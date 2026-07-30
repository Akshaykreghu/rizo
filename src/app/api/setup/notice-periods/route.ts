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
    'SELECT notice_pkey, notice_days, description, status FROM notice_period WHERE status = 1 ORDER BY notice_days'
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

  const [dupDays] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM notice_period WHERE notice_days = ? AND status = 1',
    [Number(body.notice_days) || 0]
  );
  if (dupDays.length) {
    return NextResponse.json({ error: 'A notice period with this many days already exists' }, { status: 409 });
  }
  const [dupDesc] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM notice_period WHERE description = ? AND status = 1',
    [body.description]
  );
  if (dupDesc.length) {
    return NextResponse.json({ error: 'A notice period with this description already exists' }, { status: 409 });
  }

  const [result] = await pool.execute<ResultSetHeader>(
    'INSERT INTO notice_period (notice_days, description, status) VALUES (?, ?, 1)',
    [Number(body.notice_days) || 0, body.description ?? '']
  );
  return NextResponse.json({ notice_pkey: result.insertId }, { status: 201 });
}
