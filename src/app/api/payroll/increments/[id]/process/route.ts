import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { processIncrement, processItemIncrement } from '@/lib/increments';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors the view.ctp "Process" button: is_item === 'Y' ? processItem() : process().
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[hike]] = await pool.execute<RowDataPacket[]>(
    'SELECT item FROM salary_hike WHERE salary_hike_pkey = ?',
    [Number(id)]
  );
  const result = hike?.item === 'Y'
    ? await processItemIncrement(pool, Number(id), session.user.loginUserId)
    : await processIncrement(pool, Number(id), session.user.loginUserId);

  return NextResponse.json(result);
}
