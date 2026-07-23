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
    `UPDATE tax_type SET tax_type = ?, tax_desc = ?, tax_occurance = ?, tax_operator = ? WHERE tax_type_pkey = ?`,
    [body.tax_type, body.tax_desc ?? '', body.tax_occurance ?? '', body.tax_operator ?? '', id]
  );
  return NextResponse.json({ success: true });
}

// Mirrors TaxHeadsController::Deletetaxtype() — soft-delete via tax_status = 0.
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
  await pool.execute('UPDATE tax_type SET tax_status = 0 WHERE tax_type_pkey = ?', [id]);
  return NextResponse.json({ success: true });
}
