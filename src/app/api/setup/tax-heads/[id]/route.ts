import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function PUT(
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

  const [[current]] = await pool.execute<RowDataPacket[]>(
    'SELECT tax_type_fkey FROM tax_heads WHERE tax_heads_pkey = ?', [id]
  );
  const taxTypeFkey = body.tax_type_fkey ?? current?.tax_type_fkey;
  const [[type]] = await pool.execute<RowDataPacket[]>(
    'SELECT tax_type FROM tax_type WHERE tax_type_pkey = ?', [taxTypeFkey]
  );

  await pool.execute(
    `UPDATE tax_heads SET tax_name = ?, tax_type_fkey = ?, tax_type = ?, tax_details = ?,
            order_level1 = ?, attr1 = ? WHERE tax_heads_pkey = ?`,
    [
      body.tax_name, taxTypeFkey, type?.tax_type ?? '', body.tax_details ?? '',
      Number(body.order_level1) || 0, body.attr1 ?? '0', id,
    ]
  );
  return NextResponse.json({ success: true });
}

// Mirrors TaxHeadsController::Deletetaxhead() — soft-delete via tax_active = 'N'.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  await pool.execute(`UPDATE tax_heads SET tax_active = 'N' WHERE tax_heads_pkey = ?`, [id]);
  return NextResponse.json({ success: true });
}
