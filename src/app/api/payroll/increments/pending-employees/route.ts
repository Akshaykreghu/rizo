import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { listPendingEmployees } from '@/lib/increments';
import { NextRequest, NextResponse } from 'next/server';

// Mirrors SalaryIncrementController::employeelistPending() — active employees whose next
// increment is due (<= 44 days), overdue, or who have no salary structure at all.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const pool = await getCompanyPool(session.user.companyCode);
  const rows = await listPendingEmployees(pool, {
    status: sp.get('status') ?? undefined,
    branch: sp.get('branch') ?? undefined,
    structureId: sp.get('structure') ?? undefined,
    empName: sp.get('emp') ?? undefined,
  });
  return NextResponse.json({ rows });
}
