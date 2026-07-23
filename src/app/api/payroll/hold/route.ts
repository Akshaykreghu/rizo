import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

// Mirrors PayrollController::holdProcessPayroll() — sets action='Hold' on selected rows.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as { ids: number[] };
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: 'ids is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  await pool.query(
    `UPDATE payroll_master SET action = 'Hold' WHERE payroll_master_pkey IN (${body.ids.map(() => '?').join(',')})`,
    body.ids
  );

  return NextResponse.json({ success: true });
}
