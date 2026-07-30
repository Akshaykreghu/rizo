import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { controlPool } from '@/lib/db';
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
  const deviceId = Number(body.deviceid);
  if (!deviceId) return NextResponse.json({ error: 'Device is required' }, { status: 400 });

  await controlPool.execute(
    `UPDATE emp_device_comp_branch SET deviceid = ?, emp_device_id = ?, modified_by = ?, modified_date = NOW()
     WHERE emp_device_comp_branch_seq = ? AND Company_code = ?`,
    [deviceId, Number(body.emp_device_id) || 0, session.user.loginUserId, id, session.user.companyCode]
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
  await controlPool.execute(
    'UPDATE emp_device_comp_branch SET status = 0 WHERE emp_device_comp_branch_seq = ? AND Company_code = ?',
    [id, session.user.companyCode]
  );
  return NextResponse.json({ success: true });
}
