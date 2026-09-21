import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports listleavebalance() (controller.php:931-1009) — joins leave_balance_upload -> emp_proff
// (on emp_company_id, since empid stores the company employee code, not emp_pkey) -> emp_details,
// status IN (0,1) (0 = processed, 1 = pending Leave_balance_upload_fn), branch/employee filters.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const page = Number(searchParams.get('page') ?? '1');
  const rows = Number(searchParams.get('rows') ?? '10');
  const employee = searchParams.get('employee') ?? '';
  const branch = searchParams.get('branch') ?? '';
  const month = searchParams.get('month') ?? '';
  const offset = (Math.max(page, 1) - 1) * rows;

  const pool = await getCompanyPool(session.user.companyCode);

  // month is not part of legacy's own listleavebalance() — it reads $arr_request_data['month']
  // but never adds it to $conditions, a dead parameter in the original (same read-but-unused
  // pattern seen elsewhere in this controller). Added here as a genuine filter on created_date
  // (the upload's timestamp), since there's no other date field on this table to filter by.
  const conditions = ['lbu.status IN (0, 1)'];
  const values: (string | number)[] = [];
  if (employee) {
    conditions.push('ed.emp_pkey = ?');
    values.push(Number(employee));
  }
  if (branch) {
    conditions.push('ed.branch_code = ?');
    values.push(branch);
  }
  if (month) {
    conditions.push("DATE_FORMAT(lbu.created_date, '%Y-%m') = ?");
    values.push(month);
  }
  const whereClause = conditions.join(' AND ');

  const [[countRow]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM leave_balance_upload lbu
     LEFT JOIN emp_proff ep ON ep.emp_company_id = lbu.empid
     LEFT JOIN emp_details ed ON ed.emp_pkey = ep.emp_fkey
     WHERE ${whereClause}`,
    values
  );

  const [dataRows] = await pool.execute<RowDataPacket[]>(
    `SELECT lbu.leave_balance_upload_pky, lbu.leave_balance, lbu.item, lbu.created_by,
            lbu.created_date, ed.emp_id, ed.emp_pkey,
            CONCAT(IFNULL(ed.first_name,''),' ',IFNULL(ed.middile_name,''),' ',IFNULL(ed.last_name,'')) AS emp_name
     FROM leave_balance_upload lbu
     LEFT JOIN emp_proff ep ON ep.emp_company_id = lbu.empid
     LEFT JOIN emp_details ed ON ed.emp_pkey = ep.emp_fkey
     WHERE ${whereClause}
     ORDER BY lbu.leave_balance_upload_pky DESC
     LIMIT ${Math.max(rows, 1)} OFFSET ${Math.max(offset, 0)}`,
    values
  );

  // created_date is a TIMESTAMP (not a plain DATE like the leave-request upload's start/end dates),
  // so it's left as the string mysql2 already returns rather than run through toISODate (which
  // would truncate the time component the grid wants to show).
  return NextResponse.json({ data: dataRows, total: Number(countRow?.cnt ?? 0) });
}
