import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports LeaveEncashmentRequestController::encashlisting() — the HR grid's "Encash All" bulk-generate
// action. Delegates the actual eligibility computation and row creation entirely to the stored proc
// (branch/employee/item filters may all be empty, matching legacy's optional-filter behavior).
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { branchCode, employee, itemFkey, month } = body as {
    branchCode?: string; employee?: number | string; itemFkey?: number | string; month: string;
  };
  if (!month) return NextResponse.json({ error: 'month is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);

  await pool.query('CALL leave_encash_insert_prc(?, ?, ?, ?, ?, @perr_msg)', [
    branchCode ?? '', employee ?? '', itemFkey ?? '', `${month}-01`, session.user.loginUserId,
  ]);
  const [[msgRow]] = await pool.query<RowDataPacket[]>('SELECT @perr_msg AS msg');

  return NextResponse.json({ success: true, procMessage: msgRow?.msg ?? null });
}
