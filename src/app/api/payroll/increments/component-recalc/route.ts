import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { recalcComponentBreakup, type ComponentRecalcInput } from '@/lib/increments';
import { NextRequest, NextResponse } from 'next/server';

// Mirrors SalaryIncrementController::onIncrementChangeNew() — one component's new value in, the
// recomputed value of every dependent component out.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as ComponentRecalcInput;
  if (!body.structureId || !body.changedItemPkey) {
    return NextResponse.json({ error: 'structureId and changedItemPkey are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const rows = await recalcComponentBreakup(pool, body);
  return NextResponse.json({ rows });
}
