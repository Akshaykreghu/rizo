import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);

  const [[empRow], [presentRow]] = await Promise.all([
    pool.execute<RowDataPacket[]>('SELECT COUNT(*) as total FROM emp_details WHERE status = 1'),
    pool.execute<RowDataPacket[]>('SELECT COUNT(*) as total FROM present_today'),
  ]);

  let pendingLeaves = 0;
  if (session.user.userGroup === 1) {
    const loginUserId = session.user.loginUserId;
    const [leaveRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM leaveentries
       WHERE (ISAutherizedby = ? AND ISAutherized = '0' AND LEAVESTATUS IN ('Applied'))
          OR (APPROVEDBY = ? AND ISAPPROVED = '0' AND ISAutherized = '1' AND LEAVESTATUS IN ('Authorized'))`,
      [loginUserId, loginUserId]
    );
    pendingLeaves = leaveRows[0]?.total ?? 0;
  }

  return NextResponse.json({
    totalEmployees: empRow[0]?.total ?? 0,
    presentToday: presentRow[0]?.total ?? 0,
    pendingLeaves,
  });
}
