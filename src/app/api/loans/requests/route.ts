import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { createLoanRequest, listLoanRequests, type LoanRequestStatus } from '@/lib/loans';
import { NextRequest, NextResponse } from 'next/server';

// Loan Application "My Request" flow. Employee submissions land here (Pending), NOT directly in
// emp_loan — see lib/loans.ts's comment above these helpers for why. Same admin-vs-self-service
// ownership pattern as POST/GET /api/loans.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isAdmin = session.user.userGroup === 1;
  const empFkey = isAdmin ? request.nextUrl.searchParams.get('empFkey') : String(session.user.empFkey);
  const requestStatus = request.nextUrl.searchParams.get('status') as LoanRequestStatus | null;
  const month = request.nextUrl.searchParams.get('month');

  const pool = await getCompanyPool(session.user.companyCode);
  const rows = await listLoanRequests(pool, {
    empFkey: empFkey ? Number(empFkey) : undefined,
    requestStatus: requestStatus ?? undefined,
    month: month ?? undefined,
  });
  return NextResponse.json({ rows });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as {
    empFkey?: number; loanAmount: number; tenure: number; interestRate?: number; emiStartMonth: string; remarks?: string;
  };
  const empFkey = session.user.userGroup === 1 ? body.empFkey : session.user.empFkey;
  if (!empFkey || !body.loanAmount || !body.tenure || !body.emiStartMonth) {
    return NextResponse.json({ error: 'empFkey, loanAmount, tenure, emiStartMonth are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const id = await createLoanRequest(pool, {
    empFkey, loanAmount: body.loanAmount, tenure: body.tenure,
    interestRate: body.interestRate ?? 0, emiStartMonth: body.emiStartMonth, remarks: body.remarks,
  }, session.user.loginUserId);
  return NextResponse.json({ id }, { status: 201 });
}
