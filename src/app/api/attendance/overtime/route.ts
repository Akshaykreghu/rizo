import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports OtAttendanceNewController's getNotApprovedData/getApprovedData: OT is only listed once the
// employee's attendance for that month has been verified (attendance_register.isdelete='N') — the
// real cross-module dependency, expressed here as an EXISTS check rather than a hard block elsewhere.

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  const branch = searchParams.get('branch');
  const tab = searchParams.get('tab') === 'approved' ? 'approved' : 'not-approved';
  if (!month || !branch) {
    return NextResponse.json({ error: 'month and branch are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT eot.emp_ot_master_pkey, eot.emp_fkey, eot.emp_name, eot.total_duration, eot.set_duration, eot.is_verified
     FROM emp_ot_master eot
     JOIN emp_details ed ON ed.emp_pkey = eot.emp_fkey
     WHERE ed.branch_code = ? AND DATE_FORMAT(eot.month, '%Y-%m') = ?
       AND eot.is_verified = ?
       AND EXISTS (
         SELECT 1 FROM attendance_register ar
         WHERE ar.emp_fkey = eot.emp_fkey AND ar.month_year = ? AND ar.isdelete = 'N'
       )
     ORDER BY eot.emp_name`,
    [branch, month, tab === 'approved' ? 'Y' : 'N', month]
  );

  const data = rows.map((r) => ({
    empOtMasterPkey: r.emp_ot_master_pkey,
    empFkey: r.emp_fkey,
    empName: r.emp_name,
    totalDurationMin: Number(r.total_duration ?? 0),
    setDurationMin: Number(r.set_duration ?? 0),
    isVerified: r.is_verified === 'Y',
  }));

  return NextResponse.json({ tab, data });
}
