import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';

export async function POST(
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

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO work_experience (emp_join_fkey, company, from_date, to_date, designation, department, salary, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [id, body.company, body.from_date, body.to_date, body.designation, body.department, body.salary ? Number(body.salary) : null]
  );

  return NextResponse.json({ experience_pkey: result.insertId }, { status: 201 });
}
