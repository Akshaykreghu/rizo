import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// See ../education/route.ts for why this bridges through emp_join.emp_fkey.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (session.user.userGroup !== 1 && session.user.empFkey !== parseInt(id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT x.experience_pkey, x.company AS company_name, x.department, x.designation,
            x.from_date, x.to_date, x.salary
     FROM work_experience x
     JOIN emp_join j ON j.emp_join_pkey = x.emp_join_fkey
     WHERE j.emp_fkey = ? AND x.status = 1
     ORDER BY x.experience_pkey DESC`,
    [id]
  );
  return NextResponse.json(rows);
}
