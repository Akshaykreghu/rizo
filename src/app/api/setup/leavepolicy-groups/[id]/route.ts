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
  const name = String(body.LEAVEPOLICY_GROUP_NAME ?? '').trim();
  if (!name) {
    return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
  }
  const pool = await getCompanyPool(session.user.companyCode);

  const [existing] = await pool.execute<RowDataPacket[]>(
    'SELECT LEAVEPOLICY_GROUP_ID FROM leavepolicy_group WHERE LEAVEPOLICY_GROUP_NAME = ? AND status = 1 AND LEAVEPOLICY_GROUP_ID != ?',
    [name, id]
  );
  if (existing.length > 0) {
    return NextResponse.json({ error: 'Leave Policy Group already exists' }, { status: 409 });
  }

  await pool.execute(
    'UPDATE leavepolicy_group SET LEAVEPOLICY_GROUP_NAME = ? WHERE LEAVEPOLICY_GROUP_ID = ?',
    [name, id]
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
     WHERE ep.LEAVEPOLICY_GROUP_ID = ? AND ed.status = 1`,
    [id]
  );
  if ((assigned[0].cnt as number) > 0) {
    return NextResponse.json(
      { error: 'Leave policy cannot be deleted, remove employees under this Policy' },
      { status: 409 }
    );
  }

  await pool.execute('UPDATE leavepolicy_group SET status = 0 WHERE LEAVEPOLICY_GROUP_ID = ?', [id]);
  await pool.execute('UPDATE emp_proff SET LEAVEPOLICY_GROUP_ID = NULL WHERE LEAVEPOLICY_GROUP_ID = ?', [id]);
  return NextResponse.json({ success: true });
}
