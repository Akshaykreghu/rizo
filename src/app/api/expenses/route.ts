import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getAuthorizerApprover } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports EmployeeExpensesController (menu items "Expense Requests" + "Manage Expenses" — both the
// same controller/table, emp_expense). Admin-only, matching the established precedent for every
// other request/approve flow in this app (Leave Requests, Regularisation, Resignation) — there is
// no separate employee self-service login, so admin picks the employee and acts on their behalf.
// `is_credited` confirmed vestigial for expenses (unlike EmployeeAdvance, where it drives payroll
// deduction) — expenses never feed payroll_master in legacy; this is a tracking workflow only.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const employee = searchParams.get('employee') ?? '';
  const status = searchParams.get('status') ?? '';

  const pool = await getCompanyPool(session.user.companyCode);
  const conditions: string[] = ['e.status != 0'];
  const values: (string | number)[] = [];
  if (employee) { conditions.push('e.emp_fkey = ?'); values.push(Number(employee)); }
  if (status) { conditions.push('e.expense_status = ?'); values.push(status); }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT e.emp_expenses_pkey, e.emp_fkey, e.expense_type, e.expenses_amount, e.affected_month,
            e.expense_date, e.vendor, e.purpose, e.remarks, e.image, e.expense_status,
            e.authorized_by, e.authorized_date, e.remarks_auth,
            e.approved_by, e.approved_date, e.remarks_approved,
            ed.first_name, ed.last_name, ed.emp_id
     FROM emp_expense e
     JOIN emp_details ed ON ed.emp_pkey = e.emp_fkey
     WHERE ${conditions.join(' AND ')}
     ORDER BY e.emp_expenses_pkey DESC
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
  const { empFkey, expenseType, expensesAmount, affectedMonth, expenseDate, vendor, purpose, remarks } = body as {
    empFkey: number; expenseType: string; expensesAmount: number; affectedMonth: string;
    expenseDate?: string; vendor?: string; purpose?: string; remarks?: string;
  };

  if (!empFkey || !expenseType || !expensesAmount || !affectedMonth) {
    return NextResponse.json(
      { error: 'empFkey, expenseType, expensesAmount and affectedMonth are required' },
      { status: 400 }
    );
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const { authorizerFkey, approverFkey } = await getAuthorizerApprover(pool, session.user.companyCode, empFkey);

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO emp_expense
       (emp_fkey, expense_type, expenses_amount, affected_month, expense_date, vendor, purpose, remarks,
        authorized_by, authorized_date, remarks_auth, approved_by, approved_date, remarks_approved,
        is_credited, expense_status, created_date, created_by, modified_by, modified_date, image, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '1970-01-01', '', ?, '1970-01-01', '', '', 'Applied', NOW(), ?, ?, NOW(), '', 1)`,
    [
      empFkey, expenseType, Number(expensesAmount), affectedMonth, expenseDate ?? affectedMonth,
      vendor ?? null, purpose ?? null, remarks ?? null,
      authorizerFkey ?? '', approverFkey ?? '', session.user.loginUserId, session.user.loginUserId,
    ]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
