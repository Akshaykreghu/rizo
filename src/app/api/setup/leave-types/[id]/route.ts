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
  const value = body.value === 'Y' ? 'Y' : 'N';
  const pool = await getCompanyPool(session.user.companyCode);

  await pool.execute(
    "UPDATE salary_head_items SET value = ? WHERE salary_head_item_pkey = ? AND item_type = 'LEAVE'",
    [value, id]
  );
  return NextResponse.json({ success: true });
}
