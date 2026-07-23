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
    `UPDATE asset_management
     SET name = ?, specifications = ?, Type = ?, serial_no = ?, warranty = ?, model = ?, brand = ?, value = ?, year = ?
     WHERE asset_pkey = ?`,
    [
      body.name, body.specifications ?? null, body.Type ?? null, body.serial_no ?? null,
      body.warranty ?? null, body.model ?? null, body.brand ?? null, body.value ?? null, body.year ?? null,
      id,
    ]
  );
  return NextResponse.json({ success: true });
}

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

  await pool.execute(`UPDATE asset_management SET active = '0' WHERE asset_pkey = ?`, [id]);
  return NextResponse.json({ success: true });
}
