import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { SHIFT_COLUMNS, shiftValues, insertExceptions } from '../route';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM working_day_time_procedures WHERE day_time_seq = ?',
    [id]
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [exceptions] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM shift_exceptions WHERE shift_id = ? AND status = 1 ORDER BY ex_week_day, ex_week',
    [id]
  );

  return NextResponse.json({ ...rows[0], exceptions });
}

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

  const [dup] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM working_day_time_procedures WHERE day_time_desc = ? AND active <> 0 AND day_time_seq != ?',
    [body.day_time_desc, id]
  );
  if (dup.length) {
    return NextResponse.json({ error: 'Shift name already exists' }, { status: 409 });
  }

  const modifiedBy = session.user.loginUserId;
  await pool.execute(
    `UPDATE working_day_time_procedures SET
       ${SHIFT_COLUMNS.map((c) => `${c} = ?`).join(', ')}, modified_by = ?
     WHERE day_time_seq = ?`,
    [...shiftValues(body), modifiedBy, id]
  );

  await pool.execute('UPDATE shift_exceptions SET status = 0 WHERE shift_id = ?', [id]);
  if (Number(body.is_exception) === 1 && Array.isArray(body.exceptions)) {
    await insertExceptions(pool, Number(id), body.exceptions, modifiedBy);
  }

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

  await pool.execute('UPDATE working_day_time_procedures SET active = 0 WHERE day_time_seq = ?', [id]);
  await pool.execute('UPDATE shift_exceptions SET status = 0 WHERE shift_id = ?', [id]);
  return NextResponse.json({ success: true });
}
