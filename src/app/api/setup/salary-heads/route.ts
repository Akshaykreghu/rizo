import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports SalaryHeadsController's category (salary_heads) CRUD. Confirmed live: 10 rows exist,
// only head_pkey 1/4/5/9/10 are status=1 (2/3/7/8 are dead/never-activated legacy cruft) —
// all 10 are still listed here so an admin can see/reactivate, matching legacy's own index.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT head_pkey, head_desc, head_operator, head_occurance, salary_head_order1, status FROM salary_heads ORDER BY salary_head_order1, head_pkey'
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
    `INSERT INTO salary_heads (head_desc, head_operator, head_occurance, salary_head_order1, status)
     VALUES (?, ?, ?, ?, 1)`,
    [body.head_desc, body.head_operator ?? '', body.head_occurance ?? '', Number(body.salary_head_order1) || 0]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
