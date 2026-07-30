import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { controlPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports DeviceController.php — a real, live-routed legacy screen (confirmed via hrm_menu row
// 'Device') for configuring biometric/attendance punch devices. Its `devices` table lives in
// mypayrol_control_db (not the per-company DB), scoped by company_code — matches legacy's own
// `mypayrol_control_db.devices` queries, so this route uses controlPool directly.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [rows] = await controlPool.execute<RowDataPacket[]>(
    `SELECT d.DeviceId, d.DeviceFName, d.branch_code, cb.branch_name, d.SerialNumber, d.DeviceLocation
     FROM devices d
     LEFT JOIN company_branches cb ON cb.branch_code = d.branch_code
     WHERE d.company_code = ?
     ORDER BY d.DeviceId DESC`,
    [session.user.companyCode]
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const serialNumber = String(body.SerialNumber ?? '').trim();
  const deviceLocation = String(body.DeviceLocation ?? '').trim();
  if (!serialNumber || !deviceLocation) {
    return NextResponse.json({ error: 'Serial Number and Device Location are required' }, { status: 400 });
  }

  const [maxRow] = await controlPool.execute<RowDataPacket[]>(
    'SELECT MAX(DeviceId) AS maxId FROM devices WHERE company_code = ?',
    [session.user.companyCode]
  );
  const newDeviceId = Number(maxRow[0].maxId ?? 0) + 1;

  await controlPool.execute<ResultSetHeader>(
    `INSERT INTO devices (DeviceId, DeviceFName, DeviceSName, branch_code, SerialNumber, DeviceLocation, company_code)
     VALUES (?, ?, '', ?, ?, ?, ?)`,
    [newDeviceId, body.DeviceFName ?? '', body.branch_code ?? '', serialNumber, deviceLocation, session.user.companyCode]
  );
  return NextResponse.json({ DeviceId: newDeviceId }, { status: 201 });
}
