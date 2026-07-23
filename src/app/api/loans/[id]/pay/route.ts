import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { payLoanAmount } from '@/lib/loans';
import { NextRequest, NextResponse } from 'next/server';

// Mirrors EmployeeLoanController::amount_pay().
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json() as { amount: number };
  if (!body.amount || body.amount <= 0) {
    return NextResponse.json({ error: 'A positive amount is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  await payLoanAmount(pool, Number(id), body.amount, session.user.loginUserId);
  return NextResponse.json({ success: true });
}
