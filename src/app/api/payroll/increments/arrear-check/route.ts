import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { checkArrear } from '@/lib/increments';
import { NextRequest, NextResponse } from 'next/server';

// Mirrors SalaryIncrementController::onEffectiveDateChange() — tells the form whether the chosen
// effective date lands in a month whose payroll is already Approved/Processed (so the raise will
// be paid as arrear).
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const empFkey = Number(request.nextUrl.searchParams.get('empFkey'));
  const date = request.nextUrl.searchParams.get('date') ?? '';
  if (!empFkey || !date) {
    return NextResponse.json({ error: 'empFkey and date are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const result = await checkArrear(pool, empFkey, date, session.user.companyCode);
  return NextResponse.json(result);
}
