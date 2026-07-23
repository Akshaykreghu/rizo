import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getLeaveBalance, toISODate } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Wraps leave_balance_inthe_year_fn / leave_balance_inthe_month_fn for one leaveentries row, branching
// on the leave type's ALLOW_NEGETIVE flag — matches criterias()'s balance lookup. Informational only:
// per project decision, the balance-insufficiency check stays disabled (matches live legacy, which has
// this comparison commented out) — this endpoint surfaces the number, it does not block anything.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[entry]] = await pool.execute<RowDataPacket[]>(
    `SELECT le.EMP_fkey, le.salary_head_item_fkey, le.FROMDATE, le.leave_days, lp.ALLOW_NEGETIVE
     FROM leaveentries le
     JOIN emp_proff ep ON ep.emp_fkey = le.EMP_fkey
     JOIN leavepolicy lp ON lp.LEAVEPOLICY_GROUP_ID = ep.LEAVEPOLICY_GROUP_ID AND lp.salary_head_item_fkey = le.salary_head_item_fkey
     WHERE le.LEAVEENTRYID = ?`,
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });

  const balance = await getLeaveBalance(
    pool, entry.EMP_fkey, entry.salary_head_item_fkey, toISODate(entry.FROMDATE), entry.ALLOW_NEGETIVE === 'Y'
  );

  return NextResponse.json({
    balanceBeforeRequest: balance,
    requestedDays: Number(entry.leave_days),
    balanceAfterRequest: balance - Number(entry.leave_days),
    allowNegative: entry.ALLOW_NEGETIVE === 'Y',
  });
}
