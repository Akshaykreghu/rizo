import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

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
  await pool.execute(
    `UPDATE tax_heads_details SET tax_heads_details = ?, tax_heads_details1 = ?,
            tax_heads_details2 = ?, fieldtype = ?, active = ? WHERE tax_heads_details_pkey = ?`,
    [
      body.tax_heads_details, body.tax_heads_details1 ?? '', body.tax_heads_details2 ?? '0',
      Number(body.fieldtype) || 1, body.active === '0' ? 0 : 1, id,
    ]
  );
  return NextResponse.json({ success: true });
}

// Mirrors TaxHeadsController::removeTaxHead() — soft-delete via active = 0.
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
  await pool.execute('UPDATE tax_heads_details SET active = 0 WHERE tax_heads_details_pkey = ?', [id]);
  return NextResponse.json({ success: true });
}
