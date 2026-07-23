import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') ?? '';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1);
  const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') ?? '25') || 25);
  const offset = (page - 1) * pageSize;

  const conditions: string[] = ['e.status = 1'];
  const params: string[] = [];
  if (search) {
    conditions.push('(e.first_name LIKE ? OR e.last_name LIKE ? OR uc.user_id LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const baseJoin = `
     FROM emp_details e
     LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
     LEFT JOIN user_credentials uc ON uc.emp_fkey = e.emp_pkey
     LEFT JOIN mob_user_credentials mc ON mc.user_id = uc.user_id`;

  const [[countRow], [rows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(`SELECT COUNT(*) as total ${baseJoin} ${where}`, params),
    pool.execute<RowDataPacket[]>(
      `SELECT e.emp_pkey, e.first_name, e.last_name, e.mobile_no, e.email,
              p.emp_company_id,
              uc.user_pkey, uc.user_id, uc.access_allowed, uc.locked, uc.reset_login_flag,
              uc.incorrect_login_attempt,
              mc.locked AS mobile_locked, mc.punchtype
       ${baseJoin}
       ${where}
       ORDER BY e.first_name, e.last_name
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    ),
  ]);

  return NextResponse.json({ data: rows, total: countRow[0]?.total ?? 0 });
}
