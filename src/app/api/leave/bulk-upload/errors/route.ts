import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Parity with showfailedleaverequests() (controller.php:2095) — lets a completed batch's per-row
// failures stay queryable by PID after the initial upload response, instead of only existing in
// that one JSON payload.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pid = request.nextUrl.searchParams.get('pid');
  if (!pid) {
    return NextResponse.json({ error: 'pid is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ue.*, ed.first_name, ed.last_name
     FROM Upload_leave_errirs ue
     JOIN emp_details ed ON (ed.emp_pkey = ue.emp_fkey)
     WHERE ue.PID = ?
     ORDER BY ue.Upload_leave_errirs_pkey`,
    [pid]
  );

  return NextResponse.json({ data: rows });
}
