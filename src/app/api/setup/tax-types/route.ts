import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports TaxHeadsController's tax_type CRUD (top-level category — Income/Deductions/Bills/
// Miscellaneous live). Fixed/rarely-touched but legacy does allow admin editing, so ported.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT tax_type_pkey, tax_type, tax_desc, tax_status, tax_occurance, tax_operator FROM tax_type ORDER BY tax_type_pkey'
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
    `INSERT INTO tax_type (tax_type, tax_desc, tax_status, tax_occurance, tax_operator)
     VALUES (?, ?, 1, ?, ?)`,
    [body.tax_type, body.tax_desc ?? '', body.tax_occurance ?? '', body.tax_operator ?? '']
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
