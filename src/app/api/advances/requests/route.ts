import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { createAdvanceRequest, listAdvanceRequests } from '@/lib/advances';
import { NextRequest, NextResponse } from 'next/server';

// Salary Advance "My Request" flow. Employee submissions land here (Pending), NOT directly in
// emp_advance — see lib/advances.ts's comment above these helpers for why. Same
// admin-vs-self-service ownership pattern as POST/GET /api/advances.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isAdmin = session.user.userGroup === 1;
  const empFkey = isAdmin ? request.nextUrl.searchParams.get('empFkey') : String(session.user.empFkey);
  const requestStatus = request.nextUrl.searchParams.get('status') as 'Pending' | 'Approved' | 'Rejected' | null;
  const month = request.nextUrl.searchParams.get('month');

  const pool = await getCompanyPool(session.user.companyCode);
  const rows = await listAdvanceRequests(pool, {
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
    empFkey?: number; advanceAmount: number; affectedMonth: string; remarks?: string;
  };
  const empFkey = session.user.userGroup === 1 ? body.empFkey : session.user.empFkey;
  if (!empFkey || !body.advanceAmount || !body.affectedMonth) {
    return NextResponse.json({ error: 'empFkey, advanceAmount, affectedMonth are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const id = await createAdvanceRequest(pool, { ...body, empFkey }, session.user.loginUserId);
  return NextResponse.json({ id }, { status: 201 });
}
