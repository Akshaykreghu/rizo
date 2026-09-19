import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getAttPeriod } from '@/lib/attendance';
import { toISODate } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports listleave() (controller.php:564-724) — the manual grid's list, scoped by month/employee/
// branch. Matches the existing route.ts/template's admin-only gate; legacy's userGroup==2
// branch-self-scoping isn't replicated since this whole feature is already admin-only here.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const page = Number(searchParams.get('page') ?? '1');
  const rows = Number(searchParams.get('rows') ?? '10');
  const month = searchParams.get('month') ?? '';
  const employee = searchParams.get('employee') ?? '';
  const branch = searchParams.get('branch') ?? '';
  const offset = (Math.max(page, 1) - 1) * rows;

  const pool = await getCompanyPool(session.user.companyCode);

  const conditions = ['lu.status = 1'];
  const values: (string | number)[] = [];
  if (employee) {
    conditions.push('lu.emp_fkey = ?');
    values.push(Number(employee));
  }
  if (branch) {
    conditions.push('ed.branch_code = ?');
    values.push(branch);
  }
  if (month) {
    const period = await getAttPeriod(pool, month);
    conditions.push('DATE_FORMAT(lu.leave_start_date, "%Y-%m-%d") BETWEEN ? AND ?');
    values.push(period.start, period.end);
  }
  const whereClause = conditions.join(' AND ');

  const [[countRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM emp_details ed
     INNER JOIN emp_leave_upload lu ON (ed.emp_pkey = lu.emp_fkey)
     INNER JOIN salary_head_items shi ON (shi.salary_head_item_pkey = lu.leave_type)
     INNER JOIN employee_info ei ON (ed.emp_pkey = ei.emp_pkey)
     WHERE ${whereClause}`,
    values
  );

  const [dataRows] = await pool.execute<RowDataPacket[]>(
    `SELECT lu.emp_leave_upload_pkey, lu.created_date, lu.leave_type, lu.leaveentry_id,
            lu.leave_start_date, lu.leave_start_session, lu.leave_end_date, lu.leave_end_session,
            ei.employee_id, ei.EmpName, shi.item, le.Reason
     FROM emp_details ed
     INNER JOIN emp_leave_upload lu ON (ed.emp_pkey = lu.emp_fkey)
     INNER JOIN salary_head_items shi ON (shi.salary_head_item_pkey = lu.leave_type)
     INNER JOIN leaveentries le ON (lu.leaveentry_id = le.LEAVEENTRYID)
     INNER JOIN employee_info ei ON (ed.emp_pkey = ei.emp_pkey)
     WHERE ${whereClause}
     ORDER BY lu.created_date DESC
     LIMIT ${Math.max(rows, 1)} OFFSET ${Math.max(offset, 0)}`,
    values
  );

  // mysql2 returns DATE columns as JS Date objects, which JSON.stringify serializes with a
  // T00:00:00.000Z time/timezone component — strip that down to a plain YYYY-MM-DD string.
  const data = dataRows.map((r) => ({
    ...r,
    leave_start_date: toISODate(r.leave_start_date),
    leave_end_date: toISODate(r.leave_end_date),
  }));

  return NextResponse.json({ data, total: Number(countRow?.cnt ?? 0) });
}
