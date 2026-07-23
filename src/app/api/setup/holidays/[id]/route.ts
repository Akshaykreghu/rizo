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

  const [existing] = await pool.execute<RowDataPacket[]>(
    'SELECT HOLIDAY_GROUP_ID FROM holidays WHERE HOLIDAYID = ?',
    [id]
  );
  if (!existing.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [dup] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM holidays WHERE HOLIDAY_GROUP_ID = ? AND HOLIDAYDATE = ? AND status = 1 AND HOLIDAYID != ?',
    [existing[0].HOLIDAY_GROUP_ID, body.HOLIDAYDATE, id]
  );
  if (dup.length) {
    return NextResponse.json({ error: 'Holiday date exists' }, { status: 409 });
  }

  await pool.execute(
    'UPDATE holidays SET HOLIDAYNAME = ?, HOLIDAYDATE = ?, DESCRIPTION = ? WHERE HOLIDAYID = ?',
    [body.HOLIDAYNAME, body.HOLIDAYDATE, body.DESCRIPTION, id]
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

  await pool.execute('UPDATE holidays SET status = 0 WHERE HOLIDAYID = ?', [id]);
  return NextResponse.json({ success: true });
}
