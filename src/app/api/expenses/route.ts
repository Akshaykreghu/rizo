import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getAuthorizerApprover } from '@/lib/leave';
import { expenseDateError, getExpensePeople } from '@/lib/expenses';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports EmployeeExpensesController (menu items "Expense Requests" + "Manage Expenses" — both the
// same controller/table, emp_expense). Employee self-service (userGroup !== 1) is scoped to their
// own emp_fkey on GET/POST, same precedent as attendance/regularisation and leave/encashment.
// `is_credited` confirmed vestigial for expenses (unlike EmployeeAdvance, where it drives payroll
// deduction) — expenses never feed payroll_master in legacy; this is a tracking workflow only.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const employee = session.user.userGroup === 1 ? (searchParams.get('employee') ?? '') : String(session.user.empFkey);
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
            DATE_FORMAT(e.created_date, '%Y-%m-%d %H:%i:%s') AS created_date,
            ed.first_name, ed.last_name, ed.emp_id, ed.profile_pic, pp.emp_company_id,
            -- Legacy viewrequest shows 'Admin' when no employee holds the role.
            COALESCE(NULLIF(TRIM(CONCAT(IFNULL(au.first_name, ''), ' ', IFNULL(au.last_name, ''))), ''), 'Admin') AS authorized_by_name,
            COALESCE(NULLIF(TRIM(CONCAT(IFNULL(ap.first_name, ''), ' ', IFNULL(ap.last_name, ''))), ''), 'Admin') AS approved_by_name
     FROM emp_expense e
     JOIN emp_details ed ON ed.emp_pkey = e.emp_fkey
     LEFT JOIN emp_proff pp ON pp.emp_fkey = e.emp_fkey
     LEFT JOIN emp_details au ON au.emp_pkey = e.authorized_by
     LEFT JOIN emp_details ap ON ap.emp_pkey = e.approved_by
     WHERE ${conditions.join(' AND ')}
     ORDER BY e.created_date DESC, e.emp_expenses_pkey DESC
     LIMIT 200`,
    values
  );
  return NextResponse.json({ data: rows });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { expenseType, expensesAmount, affectedMonth, expenseDate, vendor, purpose, remarks, image } = body as {
    empFkey?: number; expenseType: string; expensesAmount: number; affectedMonth: string;
    expenseDate?: string; vendor?: string; purpose?: string; remarks?: string; image?: string;
    authorizedBy?: number | string; approvedBy?: number | string;
  };
  // Employee self-service can only ever file a claim for themselves.
  const empFkey = session.user.userGroup === 1 ? body.empFkey : session.user.empFkey;

  if (!empFkey || !expenseType || !expensesAmount || !affectedMonth) {
    return NextResponse.json(
      { error: 'empFkey, expenseType, expensesAmount and affectedMonth are required' },
      { status: 400 }
    );
  }

  if (Number(expensesAmount) < 1) {
    return NextResponse.json({ error: 'Please enter a valid amount' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  // Legacy salarycheck: no claim before the joining date or for an already-processed salary month.
  const dateError = await expenseDateError(pool, Number(empFkey), String(expenseDate ?? affectedMonth).slice(0, 10));
  if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });

  let authorizerFkey: number | null;
  let approverFkey: number | null;
  if (session.user.userGroup !== 1) {
    // Employee self-service picks both people, as on legacy's form (both required) — and only
    // from the same lists the form offers.
    const people = await getExpensePeople(pool, session.user.companyCode, Number(empFkey));
    authorizerFkey = Number(body.authorizedBy) || null;
    approverFkey = Number(body.approvedBy) || null;
    if (!authorizerFkey || !people.authorizers.some((p) => p.empFkey === authorizerFkey)) {
      return NextResponse.json({ error: 'Please select a valid Authorized By' }, { status: 400 });
    }
    if (!approverFkey || !people.approvers.some((p) => p.empFkey === approverFkey)) {
      return NextResponse.json({ error: 'Please select a valid Approved By' }, { status: 400 });
    }
  } else {
    const { authorizerIds, approverIds } = await getAuthorizerApprover(pool, session.user.companyCode, empFkey);
    authorizerFkey = Number(body.authorizedBy) || authorizerIds[0] || null;
    approverFkey = Number(body.approvedBy) || approverIds[0] || null;
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO emp_expense
       (emp_fkey, expense_type, expenses_amount, affected_month, expense_date, vendor, purpose, remarks,
        authorized_by, authorized_date, remarks_auth, approved_by, approved_date, remarks_approved,
        is_credited, expense_status, created_date, created_by, modified_by, modified_date, image, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '1970-01-01', '', ?, '1970-01-01', '', '', 'Applied', NOW(), ?, ?, NOW(), ?, 1)`,
    [
      empFkey, expenseType, Number(expensesAmount), affectedMonth, expenseDate ?? affectedMonth,
      vendor ?? null, purpose ?? null, remarks ?? null,
      authorizerFkey ?? '', approverFkey ?? '', session.user.loginUserId, session.user.loginUserId,
      image ?? '',
    ]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
