import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports TaxHeadsController's tax_heads_details CRUD (sub-line-items, e.g. HRA's 4 quarters),
// scoped by ?headId=. tax_heads_details2 is the per-line cap used inside
// tax_salary_distribution_fn's deduction-capping logic.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const headId = searchParams.get('headId');
  if (!headId) return NextResponse.json({ error: 'headId is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT tax_heads_details_pkey, tax_heads_fkey, tax_heads_details, tax_heads_details1,
            tax_heads_details2, status, fieldtype, active
     FROM tax_heads_details WHERE tax_heads_fkey = ? ORDER BY tax_heads_details_pkey`,
    [headId]
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const headId = searchParams.get('headId');
  const body = await request.json();
  if (!headId) return NextResponse.json({ error: 'headId is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO tax_heads_details
       (tax_heads_fkey, tax_heads_details, tax_heads_details1, tax_heads_details2, status, fieldtype, active)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
    [
      headId, body.tax_heads_details, body.tax_heads_details1 ?? '', body.tax_heads_details2 ?? '0',
      Number(body.fieldtype) || 1, body.active === '0' ? 0 : 1,
    ]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
