import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports LeaveEncashmentRequestController's addleave()/save() (apply, one row per leave type with
// requested_days > 0) + listing. Admin-only, same precedent as the rest of Leave Management.

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const employee = searchParams.get('employee') ?? '';
  const status = searchParams.get('status') ?? ''; // 'pending' | 'approved' | '' (all)

  const pool = await getCompanyPool(session.user.companyCode);

  const conditions = ['lem.status = 1'];
  const values: (string | number)[] = [];
  if (employee) { conditions.push('lem.emp_fkey = ?'); values.push(Number(employee)); }
  if (status === 'pending') conditions.push("lem.is_approved = 'N'");
  if (status === 'approved') conditions.push("lem.is_approved = 'Y'");

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT lem.leave_encashment_master_pkey, lem.emp_fkey, lem.emp_name, lem.branch_code,
            lem.salary_head_item_fkey, shi.item AS leave_type, lem.encash_days, lem.available_days,
            lem.requested_days, lem.approved_days, lem.is_approved, lem.approved_date, lem.fin_year,
            lem.remarks, lem.encashed_amount
     FROM leave_encashment_master lem
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = lem.salary_head_item_fkey
     WHERE ${conditions.join(' AND ')}
     ORDER BY lem.leave_encashment_master_pkey DESC
     LIMIT 200`,
    values
  );

  return NextResponse.json({ data: rows });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { empFkey, approverFkey, reason, items } = body as {
    empFkey: number; approverFkey?: number; reason?: string;
    items: { salaryHeadItemFkey: number; encashDays: number; availableDays: number; requestedDays: number }[];
  };
  if (!empFkey || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'empFkey and at least one item are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [[emp]] = await pool.execute<RowDataPacket[]>(
    'SELECT first_name, last_name, branch_code FROM emp_details WHERE emp_pkey = ?',
    [empFkey]
  );
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const [[finYear]] = await pool.execute<RowDataPacket[]>(
    `SELECT fin_year FROM fin_year
     WHERE branch_code = ? AND Year_status = 'OPEN' AND is_current_finyear = 'Y' AND status = 1
     ORDER BY start_month DESC LIMIT 1`,
    [emp.branch_code]
  );

  const empName = `${emp.first_name} ${emp.last_name ?? ''}`.trim();
  const insertedIds: number[] = [];

  for (const item of items) {
    if (!item.requestedDays || item.requestedDays <= 0) continue; // matches legacy: only requested_days > 0 rows are inserted
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO leave_encashment_master
         (emp_fkey, emp_name, branch_code, salary_head_item_fkey, encash_days, available_days,
          requested_days, created_by, approved_by, fin_year, remarks, is_approved)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N')`,
      [
        empFkey, empName, emp.branch_code, item.salaryHeadItemFkey, item.encashDays, item.availableDays,
        item.requestedDays, session.user.loginUserId, approverFkey ?? null, finYear?.fin_year ?? null, reason ?? null,
      ]
    );
    insertedIds.push(result.insertId);
  }

  if (insertedIds.length === 0) {
    return NextResponse.json({ error: 'No items had requestedDays > 0 — nothing was submitted' }, { status: 400 });
  }

  return NextResponse.json({ success: true, ids: insertedIds });
}
