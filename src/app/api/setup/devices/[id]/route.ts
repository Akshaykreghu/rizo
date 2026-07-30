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
  const serialNumber = String(body.SerialNumber ?? '').trim();
  const deviceLocation = String(body.DeviceLocation ?? '').trim();
  if (!serialNumber || !deviceLocation) {
    return NextResponse.json({ error: 'Serial Number and Device Location are required' }, { status: 400 });
  }

  await controlPool.execute(
    `UPDATE devices SET DeviceFName = ?, branch_code = ?, SerialNumber = ?, DeviceLocation = ?
     WHERE DeviceId = ? AND company_code = ?`,
    [body.DeviceFName ?? '', body.branch_code ?? '', serialNumber, deviceLocation, id, session.user.companyCode]
  );
  return NextResponse.json({ success: true });
}
