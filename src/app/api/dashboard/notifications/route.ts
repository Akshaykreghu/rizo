import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const loginUserId = session.user.loginUserId;

  const [leaveRows] = await pool.execute<RowDataPacket[]>(
    `SELECT l.leave_pkey, e.first_name, e.last_name,
            l.LEAVESTATUS, l.FROMDATE, l.TODATE, l.LEAVE_TYPE_CODE
     FROM leaveentries l
     LEFT JOIN emp_details e ON e.emp_pkey = l.EMP_fkey
     WHERE (l.ISAutherizedby = ? AND l.ISAutherized = '0' AND l.LEAVESTATUS IN ('Applied'))
        OR (l.APPROVEDBY = ? AND l.ISAPPROVED = '0' AND l.ISAutherized = '1' AND l.LEAVESTATUS IN ('Authorized'))
     ORDER BY l.FROMDATE DESC
     LIMIT 20`,
    [loginUserId, loginUserId]
  );

  return NextResponse.json({ pendingLeaves: leaveRows });
}
