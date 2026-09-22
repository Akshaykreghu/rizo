import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { applyLeaveBalanceUpload, RESTRICTED_BALANCE_COMPANIES } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports leavebalancesave() (controller.php:133-203) — single manual add. Looks up the employee's
// name and emp_proff.emp_company_id (leave_balance_upload.empid stores the company code, not
// emp_pkey), the leave type's display name (item), inserts one leave_balance_upload row, then
// runs Leave_balance_upload_fn() (here: applyLeaveBalanceUpload) for restricted companies only.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const empFkey = Number(body.empFkey);
  const salaryHeadItemFkey = Number(body.salaryHeadItemFkey);
  const leaveBalance = Number(body.leaveBalance);
  if (!empFkey || !salaryHeadItemFkey || Number.isNaN(leaveBalance)) {
    return NextResponse.json({ error: 'empFkey, salaryHeadItemFkey and leaveBalance are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const companyCode = session.user.companyCode;

  const [[emp]] = await pool.execute<RowDataPacket[]>(
    `SELECT ed.first_name, ed.middile_name, ed.last_name, ep.emp_company_id
     FROM emp_details ed LEFT JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
     WHERE ed.emp_pkey = ? AND ed.status = 1`,
    [empFkey]
  );
  if (!emp) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  }
  const empName = [emp.first_name, emp.middile_name, emp.last_name].filter(Boolean).join(' ').trim();

  const [[leaveType]] = await pool.execute<RowDataPacket[]>(
    `SELECT item FROM salary_head_items
     WHERE salary_head_item_pkey = ? AND head_fkey IN
       (SELECT head_pkey FROM salary_heads WHERE LCASE(item_type) = 'leave' AND value = 'Y' AND status = 1)
       AND status = 1`,
    [salaryHeadItemFkey]
  );
  const item = String(leaveType?.item ?? '').trim();

  await pool.execute(
    `INSERT INTO leave_balance_upload
       (empid, emp_name, leave_type, item, leave_balance, created_by, created_date, status)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), 1)`,
    [emp.emp_company_id ?? '', empName, salaryHeadItemFkey, item, leaveBalance, session.user.loginUserId]
  );

  if (RESTRICTED_BALANCE_COMPANIES.includes(companyCode)) {
    await applyLeaveBalanceUpload(pool, companyCode);
  }

  return NextResponse.json({ success: true, msg: 'Leave Uploaded successfully' });
}
