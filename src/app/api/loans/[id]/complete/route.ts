import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { markLoanCompleted } from '@/lib/loans';
import { NextRequest, NextResponse } from 'next/server';

// Mirrors EmployeeLoanController::completed() — force-mark a loan fully paid/closed.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  await markLoanCompleted(pool, Number(id));
  return NextResponse.json({ success: true });
}
