import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { runTaxDistribution, getTaxSummary, getOpenFinYear } from '@/lib/taxation';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors TaxController::setup()/Proccess() — always computes BOTH regimes so the employee/admin
// can see a side-by-side comparison before choosing. Not auto-triggered by payroll; run on demand
// when the tax screen is opened or explicitly re-run.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[emp]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_branch FROM emp_proff WHERE emp_fkey = ?',
    [id]
  );
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const finYear = await getOpenFinYear(pool, emp.emp_branch);
  if (!finYear) return NextResponse.json({ error: 'No open tax financial year for this branch' }, { status: 400 });

  await runTaxDistribution(pool, session.user.companyCode, Number(id), finYear.finYear, session.user.loginUserId);
  const summary = await getTaxSummary(pool, Number(id), finYear.finYear);

  return NextResponse.json({ finYear: finYear.finYear, summary });
}
