import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const { searchParams } = new URL(request.url);
  const activeOnly = searchParams.get('active') === '1';

  const where = activeOnly ? "WHERE availability = '1' AND status = 1" : 'WHERE status = 1';
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT template_pkey, template_name, availability, editable, creation_date
     FROM doc_template ${where} ORDER BY template_name`
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
    `INSERT INTO doc_template
       (template_name, template_content, placeholders, availability, editable, policy, created_by, creation_date, status)
     VALUES (?, ?, '', '1', '1', '0', ?, NOW(), 1)`,
    [body.template_name, body.template_content, session.user.loginUserId]
  );
  return NextResponse.json({ template_pkey: result.insertId }, { status: 201 });
}
