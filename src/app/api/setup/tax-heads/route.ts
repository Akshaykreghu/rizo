import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports TaxHeadsController's tax_heads CRUD (the actual declaration line items — 80C, HRA, etc.,
// each with a yearly limit in `attr1`), scoped by ?taxTypeFkey=. Legacy denormalizes the parent
// category name onto tax_heads.tax_type at save time (gettaxtypename()) — replicated below.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const taxTypeFkey = searchParams.get('taxTypeFkey');
  if (!taxTypeFkey) return NextResponse.json({ error: 'taxTypeFkey is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT tax_heads_pkey, tax_type_fkey, tax_name, tax_type, tax_details, order_level1,
            tax_active, attr1
     FROM tax_heads WHERE tax_type_fkey = ? ORDER BY order_level1, tax_heads_pkey`,
    [taxTypeFkey]
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const taxTypeFkey = searchParams.get('taxTypeFkey');
  const body = await request.json();
  if (!taxTypeFkey) return NextResponse.json({ error: 'taxTypeFkey is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [[type]] = await pool.execute<RowDataPacket[]>(
    'SELECT tax_type FROM tax_type WHERE tax_type_pkey = ?', [taxTypeFkey]
  );

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO tax_heads (tax_type_fkey, tax_name, tax_type, tax_details, order_level1,
                             order_level2, order_level3, tax_active, attr1, attr2, attr3)
     VALUES (?, ?, ?, ?, ?, 0, 0, 'Y', ?, '', '')`,
    [
      taxTypeFkey, body.tax_name, type?.tax_type ?? '', body.tax_details ?? '',
      Number(body.order_level1) || 0, body.attr1 ?? '0',
    ]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
