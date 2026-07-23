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
    `UPDATE salary_head_items
     SET item = ?, item_type = ?, item_value = ?, occurance = ?, item_part = ?,
         value = ?, is_show_salslip = ?, salary_head_item_order1 = ?
     WHERE salary_head_item_pkey = ?`,
    [
      body.item, body.item_type ?? 'Fixed', body.item_value ?? null, body.occurance ?? null,
      body.item_part ?? 'Direct', body.value === 'N' ? 'N' : 'Y', body.is_show_salslip === 'N' ? 'N' : 'Y',
      Number(body.salary_head_item_order1) || 0, id,
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

  await pool.execute('UPDATE salary_head_items SET status = 0 WHERE salary_head_item_pkey = ?', [id]);
  return NextResponse.json({ success: true });
}
