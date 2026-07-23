import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

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

  const [[uc]] = await pool.execute<RowDataPacket[]>(
    'SELECT user_id FROM user_credentials WHERE emp_fkey = ?',
    [id]
  );
  if (!uc) return NextResponse.json({ error: 'No login found for this employee' }, { status: 404 });

  await pool.execute(
    `UPDATE mob_user_credentials SET securitycode = '', macid = '', imei = '', token = 'Y' WHERE user_id = ?`,
    [uc.user_id]
  );

  return NextResponse.json({ success: true });
}
