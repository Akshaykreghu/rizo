import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getEmployeeCurrentStructure } from '@/lib/increments';
import { NextRequest, NextResponse } from 'next/server';

// Mirrors SalaryIncrementController::getSalaryStructure() — the current salary state the
// "Salary Update" form pre-fills from when an employee is picked (designation/branch/dept,
// current monthly gross, current structure, current component values, next increment date).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ empFkey: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { empFkey } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  return NextResponse.json(await getEmployeeCurrentStructure(pool, Number(empFkey)));
}
