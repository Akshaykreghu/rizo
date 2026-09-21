import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getEncashmentEligibility, RESTRICTED_ENCASHMENT_CAP_COMPANY_CODES } from '@/lib/leaveEncashment';
import { toISODate } from '@/lib/settlement';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports LeaveEncashmentRequestController's listing (listallempsforencash "To be Encashed" tab /
// listallempsforverified "Encashed" tab). Legacy has no manual-apply action for this feature —
// every leave_encashment_master row is created exclusively by leave_encash_insert_prc via the
// Generate button (see generate/route.ts); there is no addleave() POST or save() that inserts a
// row from client-supplied balances. A prior version of this route had a POST handler that did
// exactly that (a fabricated flow with no legacy equivalent, confirmed against the full controller
// source) — removed by product decision rather than kept as a divergent "improvement".

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? ''; // 'pending' | 'approved' | '' (all) — legacy single-page mode
  const tab = searchParams.get('tab') ?? ''; // 'pending' | 'approved' — HR grid mode (adds payroll action + eligibility)
  const branch = searchParams.get('branch') ?? '';
  const month = searchParams.get('month') ?? '';
  const item = searchParams.get('item') ?? '';

  let employee = searchParams.get('employee') ?? '';
  if (session.user.userGroup !== 1) {
    employee = String(session.user.empFkey);
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const conditions = ['lem.status = 1'];
  const values: (string | number)[] = [];
  if (employee) { conditions.push('lem.emp_fkey = ?'); values.push(Number(employee)); }
  if (branch) { conditions.push('lem.branch_code = ?'); values.push(branch); }
  if (item) { conditions.push('lem.salary_head_item_fkey = ?'); values.push(Number(item)); }
  const isApproved = tab === 'approved' || status === 'approved';
  const isPending = tab === 'pending' || status === 'pending';
  if (isApproved) conditions.push("lem.is_approved = 'Y'");
  else if (isPending) conditions.push("lem.is_approved = 'N'");

  const monthYear = month || new Date().toISOString().slice(0, 7);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT lem.leave_encashment_master_pkey, lem.emp_fkey, lem.emp_name, lem.branch_code,
            lem.salary_head_item_fkey, shi.item AS leave_type, lem.encash_days, lem.available_days,
            lem.requested_days, lem.approved_days, lem.is_approved, lem.approved_date, lem.fin_year,
            lem.remarks, lem.encashed_amount, ep.emp_company_id,
            (SELECT action FROM payroll_master pm WHERE pm.emp_fkey = lem.emp_fkey AND pm.month_year = ?) AS action
     FROM leave_encashment_master lem
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = lem.salary_head_item_fkey
     LEFT JOIN emp_proff ep ON ep.emp_fkey = lem.emp_fkey
     WHERE ${conditions.join(' AND ')}
     ORDER BY lem.leave_encashment_master_pkey DESC
     LIMIT 200`,
    [monthYear, ...values]
  );

  // HR grid "To be Encashed" tab only: attach policy-cycle eligibility so the UI can cap the
  // editable amount, skipped for restricted_companies exactly as listallempsforencash() does.
  if (tab === 'pending' && !RESTRICTED_ENCASHMENT_CAP_COMPANY_CODES.includes(session.user.companyCode)) {
    for (const row of rows) {
      const eligibility = await getEncashmentEligibility(pool, row.emp_fkey, row.salary_head_item_fkey);
      row.leaveLimit = eligibility.leaveLimit;
      row.alreadyEncashed = eligibility.alreadyEncashed;
      row.canEncash = eligibility.canEncash;
    }
  }

  // mysql2 returns DATE columns as JS Date objects, which JSON.stringify serializes with a
  // T00:00:00.000Z time/timezone component — approved_date is a date-only field, so strip that
  // down to a plain YYYY-MM-DD string before it reaches the client.
  const data = rows.map((r) => ({
    ...r,
    approved_date: r.approved_date != null ? toISODate(r.approved_date) : null,
  }));

  return NextResponse.json({ data });
}
