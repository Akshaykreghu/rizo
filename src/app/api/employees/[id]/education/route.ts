import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Education/work_experience (see ../experience) are keyed to emp_join, the pre-onboarding
// staging record, not directly to emp_details — bridge through emp_join.emp_fkey. Most
// already-onboarded employees have no emp_join row at all (bulk-imported rather than run
// through the join wizard), so an empty result here is the normal case, not a bug.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (session.user.userGroup !== 1 && session.user.empFkey !== parseInt(id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT e.education_pkey, e.course AS degree, e.university, e.duration, e.mark AS marks
     FROM Education e
     JOIN emp_join j ON j.emp_join_pkey = e.emp_join_fkey
     WHERE j.emp_fkey = ? AND e.status = 1
     ORDER BY e.education_pkey DESC`,
    [id]
  );
  return NextResponse.json(rows);
}
