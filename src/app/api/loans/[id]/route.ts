import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getLoanDetail } from '@/lib/loans';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

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

// Mirrors EmployeeLoanController::deleteEmployeeloan() — soft-delete only. Legacy's own action has
// no ownership check (see .../advances/[id]'s comment for the same gap elsewhere in this
// codebase); this adds the self-access carve-out so the loan's own owner can withdraw it. Unlike
// legacy, blocks withdrawing a loan that already has real repayment activity — a loan interacts
// with live payroll deductions (payLoanAmount/markLoanCompleted write emp_loan_info rows that
// payroll reads), so silently deleting one mid-repayment would abandon that trail with nothing to
// reverse it. A freshly-submitted loan with zero payments can still be withdrawn immediately.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[entry]] = await pool.execute<RowDataPacket[]>(
    `SELECT el.emp_loan_pkey, el.emp_fkey, el.is_completed,
            (SELECT COUNT(*) FROM emp_loan_info WHERE loan_pkey = el.emp_loan_pkey AND paid_status = 'P') AS paidRows
     FROM emp_loan el WHERE el.emp_loan_pkey = ? AND el.status = 1`,
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (session.user.userGroup !== 1 && session.user.empFkey !== entry.emp_fkey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (entry.is_completed === 'Y' || Number(entry.paidRows) > 0) {
    return NextResponse.json({ error: 'Cannot withdraw a loan that already has repayments processed' }, { status: 409 });
  }

  await pool.execute('UPDATE emp_loan SET status = 0 WHERE emp_loan_pkey = ?', [id]);
  return NextResponse.json({ success: true });
}
