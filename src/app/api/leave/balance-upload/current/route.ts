import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { RESTRICTED_BALANCE_COMPANIES } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ported from EmpleaveuploadController::getleavebalance() (controller.php:812-880) — the balance
// shown on the manual add form, distinct from downloadLeaveBalanceUploadctc()'s version used for
// the Excel template. Two real differences from that other port (template/route.ts):
//  - Non-restricted companies pass the *current attendance cycle's month-end date*
//    (att_start_end_fn(current_month, 2)) as the third param, not NULL.
//  - Restricted companies resolve fin_year with NO branch scoping at all (just
//    Year_status='OPEN' AND is_current_finyear='Y' AND status='1') — genuinely different from
//    downloadLeaveBalanceUploadctc()'s branch-scoped fin_year lookup, confirmed against source.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const employee = searchParams.get('employee');
  const leaveType = searchParams.get('leaveType');
  if (!employee || !leaveType) {
    return NextResponse.json({ error: 'employee and leaveType are required' }, { status: 400 });
  }

  const companyCode = session.user.companyCode;
  const pool = await getCompanyPool(companyCode);
  const empPkey = Number(employee);
  const salaryHeadItemFkey = Number(leaveType);

  const isRestricted = RESTRICTED_BALANCE_COMPANIES.includes(companyCode);

  let balance = 0;
  if (isRestricted) {
    const [[finYear]] = await pool.execute<RowDataPacket[]>(
      `SELECT fin_year FROM fin_year WHERE Year_status = 'OPEN' AND is_current_finyear = 'Y' AND status = 1`
    );
    if (finYear?.fin_year) {
      const [[bal]] = await pool.query<RowDataPacket[]>(
        'SELECT leave_balance_inthe_year_fn(?, ?, ?) AS bal',
        [empPkey, salaryHeadItemFkey, String(finYear.fin_year)]
      );
      balance = Number(bal?.bal ?? 0);
    }
  } else {
    const [[attEnd]] = await pool.query<RowDataPacket[]>(
      "SELECT att_start_end_fn(DATE_FORMAT(CURDATE(), '%Y-%m-01'), 2) AS d"
    );
    const monthlyAttToDate = attEnd?.d as string | Date | undefined;
    const [[bal]] = await pool.query<RowDataPacket[]>(
      'SELECT leave_balance_inthe_year_fn(?, ?, ?) AS bal',
      [empPkey, salaryHeadItemFkey, monthlyAttToDate ?? null]
    );
    balance = Number(bal?.bal ?? 0);
  }

  return NextResponse.json({ balance });
}
