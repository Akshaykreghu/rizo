import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getIncrementSummary } from '@/lib/increments';
import { NextResponse } from 'next/server';

// Mirrors SalaryIncrementController::getSummaryValue() — dashboard counters for the
// revision worklist (No Structure / Due / Overdue).
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  return NextResponse.json(await getIncrementSummary(pool));
}
