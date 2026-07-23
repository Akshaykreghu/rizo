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
    'SELECT HOLIDAY_GROUP_ID, HOLIDAY_GROUP_NAME, BRANCH_CODE, status FROM holiday_group WHERE status = 1 ORDER BY HOLIDAY_GROUP_NAME'
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

  const [result] = await pool.execute<ResultSetHeader>(
    'INSERT INTO holiday_group (COMPANY_CODE, BRANCH_CODE, HOLIDAY_GROUP_NAME, status) VALUES (?, ?, ?, 1)',
    [session.user.companyCode, body.BRANCH_CODE ?? '', body.HOLIDAY_GROUP_NAME]
  );
  return NextResponse.json({ HOLIDAY_GROUP_ID: result.insertId }, { status: 201 });
}
