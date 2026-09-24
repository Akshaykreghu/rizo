import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';

// Re-activates a resigned employee — legacy EmployeeJoinController::activateEmp(), shown in place
// of Remove when the All Employees filter is "Resigned". Like legacy it only flips status 2 -> 1;
// it does not restore the reporting links the resignation finalize step cleared.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  const [result] = await pool.execute<ResultSetHeader>(
    'UPDATE emp_details SET status = 1, modified_date = NOW() WHERE emp_pkey = ? AND status = 2',
    [id]
  );
  if (result.affectedRows === 0) {
    return NextResponse.json({ error: 'Only a resigned employee can be activated' }, { status: 409 });
  }
  return NextResponse.json({ success: true });
}
