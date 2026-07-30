import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const groupId = request.nextUrl.searchParams.get('groupId');
  const excludeId = request.nextUrl.searchParams.get('excludeId');
  if (!groupId) return NextResponse.json([]);

  const pool = await getCompanyPool(session.user.companyCode);
  const params: (string | number)[] = [groupId];
  let excludeClause = '';
  if (excludeId) {
    excludeClause = 'AND LEAVEPOLICYID != ?';
    params.push(excludeId);
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT salary_head_item_pkey, item, occurance
     FROM salary_head_items
     WHERE item_type = 'LEAVE' AND status = 1 AND value = 'Y'
       AND salary_head_item_pkey NOT IN (
         SELECT salary_head_item_fkey FROM leavepolicy
         WHERE LEAVEPOLICY_GROUP_ID = ? AND status = 1 ${excludeClause}
       )
     ORDER BY item`,
    params
  );
  return NextResponse.json(rows);
}
