import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

interface DuplicateError {
  code?: string;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT fy.Fin_year_seq, fy.branch_code, b.branch_name, fy.fin_year, fy.start_month,
            fy.end_month, fy.Year_status, fy.is_current_finyear, fy.vattr1, fy.status,
            CASE fy.vattr1 WHEN 1 THEN 'Financial' ELSE 'Leave' END AS type_label
     FROM fin_year fy
     LEFT JOIN branches b ON b.branch_code = fy.branch_code
     WHERE fy.status = 1
     ORDER BY fy.fin_year DESC`
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
  const finYear = new Date(body.start_month).getFullYear();

  try {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO fin_year
         (company_code, branch_code, fin_year, start_month, end_month, Year_status, is_current_finyear, vattr1, vattr2, vattr3, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1)`,
      [
        session.user.companyCode,
        body.branch_code,
        finYear,
        body.start_month,
        body.end_month,
        body.Year_status ?? 'OPEN',
        body.is_current_finyear === 'Y' ? 'Y' : 'N',
        Number(body.vattr1) || 0,
      ]
    );
    return NextResponse.json({ Fin_year_seq: result.insertId }, { status: 201 });
  } catch (err) {
    if ((err as DuplicateError).code === 'ER_DUP_ENTRY') {
      return NextResponse.json(
        { error: 'A financial year already exists for this branch/status/type.' },
        { status: 409 }
      );
    }
    throw err;
  }
}
