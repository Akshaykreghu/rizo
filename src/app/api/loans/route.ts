import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { createLoan, listLoans } from '@/lib/loans';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const empFkey = request.nextUrl.searchParams.get('empFkey');
  const branch = request.nextUrl.searchParams.get('branch');
  const month = request.nextUrl.searchParams.get('month');

  const pool = await getCompanyPool(session.user.companyCode);
  const rows = await listLoans(pool, {
    empFkey: empFkey ? Number(empFkey) : undefined,
    branchCode: branch ?? undefined,
    month: month ?? undefined,
  });
  return NextResponse.json({ rows });
}

// Mirrors EmployeeLoanController::employeeloansave() — creation == approval, no workflow.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as {
    empFkey: number; loanAmount: number; tenure: number; interestRate: number;
    emiStartMonth: string; remarks?: string;
  };
  if (!body.empFkey || !body.loanAmount || !body.tenure || !body.emiStartMonth) {
    return NextResponse.json({ error: 'empFkey, loanAmount, tenure, emiStartMonth are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const id = await createLoan(pool, {
    empFkey: body.empFkey, loanAmount: body.loanAmount, tenure: body.tenure,
    interestRate: body.interestRate ?? 0, emiStartMonth: body.emiStartMonth, remarks: body.remarks,
  }, session.user.loginUserId);

  return NextResponse.json({ id }, { status: 201 });
}
