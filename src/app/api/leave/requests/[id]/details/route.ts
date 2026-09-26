import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { toISODate } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ported from EmployeeLeavesController::showleavedays()/showleavedays.ctp — the "Leave Details"
// modal: leave type, current balance (leave_balance_inthe_year_fn), IS_SANDWICH/ALLOW_NEGETIVE from
// the policy, the reason, the per-day emp_leave_transactions breakdown (date/status/remarks), and
// any uploaded documents.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[entry]] = await pool.execute<RowDataPacket[]>(
    `SELECT le.LEAVEENTRYID, le.EMP_fkey, le.salary_head_item_fkey, le.LEAVESTATUS, le.Reason,
            le.FROMDATE, le.TODATE, le.file_name, le.file_type, le.ISAutherizedby, le.APPROVEDBY,
            shi.item AS leave_type
     FROM leaveentries le
     LEFT JOIN salary_head_items shi ON shi.salary_head_item_pkey = le.salary_head_item_fkey
     WHERE le.LEAVEENTRYID = ?`,
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });

  // Viewable by admin, the leave's own employee, or whichever hierarchy authorizer/approver this
  // request is routed to (the ESS Approvals queue reviews someone else's leave, same as the admin
  // Leave Requests page already can).
  const isOwnLeave = session.user.empFkey === entry.EMP_fkey;
  const isAssignedReviewer = session.user.empFkey === entry.ISAutherizedby || session.user.empFkey === entry.APPROVEDBY;
  if (session.user.userGroup !== 1 && !isOwnLeave && !isAssignedReviewer) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [[policy]] = await pool.execute<RowDataPacket[]>(
    `SELECT lp.IS_SANDWICH, lp.ALLOW_NEGETIVE
     FROM leavepolicy lp
     JOIN emp_proff ep ON ep.LEAVEPOLICY_GROUP_ID = lp.LEAVEPOLICY_GROUP_ID
     WHERE ep.emp_fkey = ? AND lp.salary_head_item_fkey = ? AND lp.status = 1`,
    [entry.EMP_fkey, entry.salary_head_item_fkey]
  );

  const [[balRow]] = await pool.query<RowDataPacket[]>(
    'SELECT leave_balance_inthe_year_fn(?, ?, ?) AS bal',
    [entry.EMP_fkey, entry.salary_head_item_fkey, toISODate(entry.TODATE)]
  );

  const [transactions] = await pool.execute<RowDataPacket[]>(
    `SELECT leave_date, Leavestatus, Remarks
     FROM emp_leave_transactions
     WHERE LEAVEENTRYID = ?
     ORDER BY leave_date`,
    [id]
  );

  const documents = (entry.file_name ?? '')
    .split(',')
    .map((name: string, i: number) => ({
      name: name.trim(),
      type: (entry.file_type ?? '').split(',')[i]?.trim() ?? '',
    }))
    .filter((d: { name: string }) => d.name !== '');

  return NextResponse.json({
    leaveType: (entry.leave_type ?? '').trim(),
    leaveBalance: Number(balRow?.bal ?? 0),
    allowNegative: policy?.ALLOW_NEGETIVE === 'Y',
    isSandwich: policy?.IS_SANDWICH === 'Y',
    reason: entry.Reason,
    status: entry.LEAVESTATUS,
    transactions: transactions.map((t) => ({
      leaveDate: toISODate(t.leave_date),
      status: t.Leavestatus,
      remarks: t.Remarks,
    })),
    documents,
  });
}
