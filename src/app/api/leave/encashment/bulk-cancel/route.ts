import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

// Bulk counterpart to [id]/cancel — ports the HR grid's multi-select "remove" action
// (cancelentries()). Admin-only: the HR bulk grid is the only multi-select surface.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { ids } = body as { ids: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const placeholders = ids.map(() => '?').join(',');
  await pool.execute(
    `UPDATE leave_encashment_master SET status = 0
     WHERE leave_encashment_master_pkey IN (${placeholders}) AND is_approved != 'Y'`,
    ids
  );

  return NextResponse.json({ success: true });
}
