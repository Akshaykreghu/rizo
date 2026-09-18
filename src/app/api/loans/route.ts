import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { createLoan, listLoans } from '@/lib/loans';
import { NextRequest, NextResponse } from 'next/server';

// Employee self-service (userGroup !== 1) is scoped to their own emp_fkey on GET/POST, same
// precedent as attendance/regularisation and leave/encashment.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isAdmin = session.user.userGroup === 1;
  const empFkey = isAdmin ? request.nextUrl.searchParams.get('empFkey') : String(session.user.empFkey);
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
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as {
    empFkey?: number; loanAmount: number; tenure: number; interestRate: number;
    emiStartMonth: string; remarks?: string;
  };
  const empFkey = session.user.userGroup === 1 ? body.empFkey : session.user.empFkey;
  if (!empFkey || !body.loanAmount || !body.tenure || !body.emiStartMonth) {
    return NextResponse.json({ error: 'empFkey, loanAmount, tenure, emiStartMonth are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const id = await createLoan(pool, {
    empFkey, loanAmount: body.loanAmount, tenure: body.tenure,
    interestRate: body.interestRate ?? 0, emiStartMonth: body.emiStartMonth, remarks: body.remarks,
  }, session.user.loginUserId);

  return NextResponse.json({ id }, { status: 201 });
}
