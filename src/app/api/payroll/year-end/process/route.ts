import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors YearEndController::processleave() — calls the real year_ending_fn(closing_year, branch),
// which carries forward capped leave balances into emp_leave_balance_year and rolls the branch's
// calendar-year fin_year row over (closes the old one, opens fin_year+1). All business logic lives
// in the live function; this route only resolves the closing year from the branch's open cycle and
// calls it, per this project's standing rule to call stored procs rather than reimplement them.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as { branch: string };
  if (!body.branch) return NextResponse.json({ error: 'branch is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [[finYear]] = await pool.execute<RowDataPacket[]>(
    `SELECT start_month FROM fin_year
     WHERE branch_code = ? AND Year_status = 'OPEN' AND is_current_finyear = 'Y' AND vattr1 = 0 AND status = 1`,
    [body.branch]
  );

  const closingYear = finYear?.start_month
    ? new Date(finYear.start_month).getFullYear()
    : new Date().getFullYear();

  await pool.query('SELECT year_ending_fn(?, ?) AS result', [String(closingYear), body.branch]);

  return NextResponse.json({ success: true });
}
