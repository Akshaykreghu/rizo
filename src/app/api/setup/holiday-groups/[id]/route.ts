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

  await pool.execute(
    'UPDATE holiday_group SET HOLIDAY_GROUP_NAME = ?, BRANCH_CODE = ? WHERE HOLIDAY_GROUP_ID = ?',
    [body.HOLIDAY_GROUP_NAME, body.BRANCH_CODE ?? '', id]
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

  const [assigned] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM emp_proff ep
     JOIN emp_details ed ON ed.emp_pkey = ep.emp_fkey
     WHERE ep.HOLIDAY_GROUP_ID = ? AND ed.status = 1`,
    [id]
  );
  if ((assigned[0].cnt as number) > 0) {
    return NextResponse.json(
      { error: 'Cannot delete: employees are assigned to this holiday group.' },
      { status: 409 }
    );
  }

  await pool.execute('UPDATE holiday_group SET status = 0 WHERE HOLIDAY_GROUP_ID = ?', [id]);
  await pool.execute('UPDATE emp_proff SET HOLIDAY_GROUP_ID = NULL WHERE HOLIDAY_GROUP_ID = ?', [id]);
  return NextResponse.json({ success: true });
}
