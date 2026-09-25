import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { rejectLoanRequest } from '@/lib/loans';
import { NextRequest, NextResponse } from 'next/server';

// Admin-only. No emp_loan/emp_loan_info rows are created on reject.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const adminRemarks = (body as { adminRemarks?: string }).adminRemarks;

  const pool = await getCompanyPool(session.user.companyCode);

  try {
    await rejectLoanRequest(pool, Number(id), session.user.loginUserId, adminRemarks);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (err instanceof Error && err.message === 'NOT_PENDING') {
      return NextResponse.json({ error: 'Only a Pending request can be rejected' }, { status: 409 });
    }
    throw err;
  }
}
