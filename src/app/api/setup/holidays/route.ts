import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const groupId = request.nextUrl.searchParams.get('groupId');
  if (!groupId) return NextResponse.json({ error: 'groupId is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT HOLIDAYID, HOLIDAY_GROUP_ID, HOLIDAYNAME, HOLIDAYDATE, DESCRIPTION, HOLIDAYTYPE, status
     FROM holidays WHERE HOLIDAY_GROUP_ID = ? AND status = 1 ORDER BY HOLIDAYDATE`,
    [groupId]
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const groupId = request.nextUrl.searchParams.get('groupId');
  if (!groupId) return NextResponse.json({ error: 'groupId is required' }, { status: 400 });

  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);

  const [dup] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM holidays WHERE HOLIDAY_GROUP_ID = ? AND HOLIDAYDATE = ? AND status = 1',
    [groupId, body.HOLIDAYDATE]
  );
  if (dup.length) {
    return NextResponse.json({ error: 'Holiday date exists' }, { status: 409 });
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO holidays (HOLIDAY_GROUP_ID, HOLIDAYNAME, HOLIDAYDATE, DESCRIPTION, HOLIDAYTYPE, status, Background, border)
     VALUES (?, ?, ?, ?, 'MANDATORY', 1, '', '')`,
    [groupId, body.HOLIDAYNAME, body.HOLIDAYDATE, body.DESCRIPTION]
  );
  return NextResponse.json({ HOLIDAYID: result.insertId }, { status: 201 });
}
