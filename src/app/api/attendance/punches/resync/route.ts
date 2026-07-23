import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports EditPunchesController::Syncame() — device_logs_resync_fn, confirmed live.

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { empFkey, month } = body as { empFkey: number; month: string };
  if (!empFkey || !month) return NextResponse.json({ error: 'empFkey and month are required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [[emp]] = await pool.execute<RowDataPacket[]>('SELECT emp_id FROM emp_details WHERE emp_pkey = ?', [empFkey]);
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const [[result]] = await pool.query<RowDataPacket[]>(
    'SELECT device_logs_resync_fn(?, ?) AS r',
    [emp.emp_id, `${month}-01`]
  );

  return NextResponse.json({ success: true, message: result?.r ?? null });
}
