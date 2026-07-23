import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors YearEndController::index()/loadprocess(): year-end operates on the branch's open
// CALENDAR-year fin_year cycle specifically (vattr1 = 0) — this tenant tracks two parallel
// fin_year cycles per branch (a calendar-year one, vattr1=0, and an Apr-Mar tax one, vattr1=1,
// confirmed live on GRTL01/GRTL08); year_ending_fn only ever processes the vattr1=0 rows, so this
// filter is not an arbitrary choice, it's matching the real live behavior exactly.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const branch = request.nextUrl.searchParams.get('branch');
  if (!branch) return NextResponse.json({ error: 'branch is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [[finYear]] = await pool.execute<RowDataPacket[]>(
    `SELECT Fin_year_seq, fin_year, start_month, end_month FROM fin_year
     WHERE branch_code = ? AND Year_status = 'OPEN' AND is_current_finyear = 'Y' AND vattr1 = 0 AND status = 1`,
    [branch]
  );
  if (!finYear) return NextResponse.json({ noFinYear: true });

  const [groups] = await pool.execute<RowDataPacket[]>(
    `SELECT LEAVEPOLICY_GROUP_ID, LEAVEPOLICY_GROUP_NAME FROM leavepolicy_group WHERE status = 1`
  );

  const result = [];
  for (const group of groups) {
    const [items] = await pool.execute<RowDataPacket[]>(
      `SELECT lp.salary_head_item_fkey, shi.item
       FROM leavepolicy lp
       LEFT JOIN salary_head_items shi ON shi.salary_head_item_pkey = lp.salary_head_item_fkey
       WHERE lp.status = 1 AND shi.status = 1 AND lp.LEAVEPOLICY_GROUP_ID = ?`,
      [group.LEAVEPOLICY_GROUP_ID]
    );
    const leaves = [];
    for (const item of items) {
      const [[pending]] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(LEAVEENTRYID) AS cnt FROM leaveentries
         WHERE salary_head_item_fkey = ? AND LEAVESTATUS IN ('Applied', 'Authorized')
           AND FROMDATE BETWEEN ? AND ?
           AND EMP_fkey IN (SELECT emp_pkey FROM emp_details WHERE branch_code = ?)`,
        [item.salary_head_item_fkey, finYear.start_month, finYear.end_month, branch]
      );
      leaves.push({ salaryHeadItemFkey: item.salary_head_item_fkey, name: item.item, pending: Number(pending?.cnt ?? 0) });
    }
    result.push({ groupId: group.LEAVEPOLICY_GROUP_ID, groupName: group.LEAVEPOLICY_GROUP_NAME, leaves });
  }

  return NextResponse.json({
    finYear: { fin_year: finYear.fin_year, start_month: finYear.start_month, end_month: finYear.end_month },
    groups: result,
  });
}
