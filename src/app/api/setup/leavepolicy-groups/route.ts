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
    'SELECT LEAVEPOLICY_GROUP_ID, LEAVEPOLICY_GROUP_NAME FROM leavepolicy_group WHERE status = 1 ORDER BY LEAVEPOLICY_GROUP_NAME'
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const name = String(body.LEAVEPOLICY_GROUP_NAME ?? '').trim();
  if (!name) {
    return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
  }
  const pool = await getCompanyPool(session.user.companyCode);

  const [existing] = await pool.execute<RowDataPacket[]>(
    'SELECT LEAVEPOLICY_GROUP_ID FROM leavepolicy_group WHERE LEAVEPOLICY_GROUP_NAME = ? AND status = 1',
    [name]
  );
  if (existing.length > 0) {
    return NextResponse.json({ error: 'Leave Policy Group already exists' }, { status: 409 });
  }

  const [result] = await pool.execute<ResultSetHeader>(
    'INSERT INTO leavepolicy_group (COMPANY_CODE, BRANCH_CODE, LEAVEPOLICY_GROUP_NAME, status) VALUES (?, ?, ?, 1)',
    [session.user.companyCode, '', name]
  );
  return NextResponse.json({ LEAVEPOLICY_GROUP_ID: result.insertId }, { status: 201 });
}
