import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports EditPunchesController::updateShiftDate() — moves a punch's SHIFTDATE (an explicit,
// narrow field, not the raw $_POST blob legacy's savepunch() forwarded to save()), then recomputes
// duration for the old date via the confirmed-live time_duration_check.

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
  const { shiftDate } = body as { shiftDate: string };
  if (!shiftDate) return NextResponse.json({ error: 'shiftDate is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [[punch]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_id, SHIFTDATE, branch_code FROM device_attandance WHERE device_attandance_seq = ?',
    [id]
  );
  if (!punch) return NextResponse.json({ error: 'Punch not found' }, { status: 404 });

  const oldShiftDate = punch.SHIFTDATE;

  await pool.execute('UPDATE device_attandance SET SHIFTDATE = ? WHERE device_attandance_seq = ?', [shiftDate, id]);

  const [[emp]] = await pool.execute<RowDataPacket[]>('SELECT emp_pkey FROM emp_details WHERE emp_id = ?', [punch.emp_id]);
  if (emp) {
    try {
      await pool.query('SELECT time_duration_check(?, ?, ?) AS r', [oldShiftDate, emp.emp_pkey, punch.branch_code]);
    } catch {
      // best-effort duration recompute; the shift-date move itself has already succeeded
    }
  }

  return NextResponse.json({ success: true });
}
