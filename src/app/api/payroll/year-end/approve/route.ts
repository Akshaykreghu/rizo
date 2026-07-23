import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors YearEndController::approve() — bulk auto-approves every Applied/Authorized leave
// request within the open calendar-year fin_year window, exactly as legacy does (a "force-clear
// pending leave before closing the year" action, not a per-request review).
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as { branch: string };
  if (!body.branch) return NextResponse.json({ error: 'branch is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [[finYear]] = await pool.execute<RowDataPacket[]>(
    `SELECT start_month, end_month FROM fin_year
     WHERE branch_code = ? AND Year_status = 'OPEN' AND is_current_finyear = 'Y' AND vattr1 = 0 AND status = 1`,
    [body.branch]
  );
  if (!finYear) return NextResponse.json({ error: 'No open financial year for this branch' }, { status: 400 });

  await pool.execute(
    `UPDATE leaveentries SET LEAVESTATUS = 'Approved', ISAutherized = 1, ISAutherizedby = 0,
            Autherized_date = CURDATE(), ISAPPROVED = 1, APPROVEDBY = 0, APPROVED_date = CURDATE(),
            Reason = 'Auto Appproval', REMARKS = 'Auto Approve'
     WHERE LEAVESTATUS IN ('Applied', 'Authorized') AND FROMDATE BETWEEN ? AND ?
       AND EMP_fkey IN (SELECT emp_pkey FROM emp_details WHERE branch_code = ?)`,
    [finYear.start_month, finYear.end_month, body.branch]
  );

  return NextResponse.json({ success: true });
}
