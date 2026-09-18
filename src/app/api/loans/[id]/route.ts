import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getLoanDetail } from '@/lib/loans';
import { NextRequest, NextResponse } from 'next/server';

// Mirrors EmployeeLoanController::viewloan() — per-loan header + computed EMI ledger.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  const detail = await getLoanDetail(pool, Number(id));
  if (!detail) {
    return NextResponse.json({ error: 'Loan not found' }, { status: 404 });
  }
  if (session.user.userGroup !== 1 && session.user.empFkey !== detail.emp_fkey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(detail);
}

// Mirrors EmployeeLoanController::deleteEmployeeloan() — soft-delete only.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  await pool.execute('UPDATE emp_loan SET status = 0 WHERE emp_loan_pkey = ?', [id]);
  return NextResponse.json({ success: true });
}
