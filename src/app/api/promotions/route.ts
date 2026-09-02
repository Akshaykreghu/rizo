import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Mirrors legacy PromoController: a promotion is a request row (promotions table,
// approved_status='N' initially) reviewed as a single central approval step (not tiered
// manager->admin) — approvesave() applies the change and flips the row to approved.
// approved_by/approved_date are NOT NULL columns with no default, so the initial request
// insert needs placeholder values until a real approval happens.

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? 'N';

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT pr.promotion_pkey, pr.emp_fkey, pr.created_date, pr.approved_status, pr.approved_date,
            pr.designation, pr.emp_type, pr.emp_dept, pr.emp_branch, pr.shift, pr.\`leave\`,
            pr.annual_gross, pr.hierarch, pr.salary, pr.remarks, pr.promotion_status, pr.created_by,
            e.first_name, e.last_name, e.emp_id,
            ds.desig_name AS new_desig_name, d.dept_name AS new_dept_name, b.branch_name AS new_branch_name,
            cur_ds.desig_name AS current_desig_name, cur_d.dept_name AS current_dept_name,
            sh.day_time_desc AS new_shift_name, lp.LEAVEPOLICY_GROUP_NAME AS new_leave_name,
            ss.structure_name AS new_structure_name,
            CONCAT(mgr.first_name, ' ', COALESCE(mgr.last_name, '')) AS new_manager_name
     FROM promotions pr
     JOIN emp_details e ON e.emp_pkey = pr.emp_fkey
     LEFT JOIN emp_proff p ON p.emp_fkey = pr.emp_fkey
     LEFT JOIN designation ds ON ds.desig_code = pr.designation
     LEFT JOIN department d ON d.dept_code = pr.emp_dept
     LEFT JOIN branches b ON b.branch_code = pr.emp_branch
     LEFT JOIN designation cur_ds ON cur_ds.desig_code = p.designation
     LEFT JOIN department cur_d ON cur_d.dept_code = p.emp_dept
     LEFT JOIN working_day_time_procedures sh ON sh.day_time_seq = pr.shift
     LEFT JOIN leavepolicy_group lp ON lp.LEAVEPOLICY_GROUP_ID = pr.\`leave\`
     LEFT JOIN salary_structure ss ON ss.structure_id = pr.salary
     LEFT JOIN emp_details mgr ON mgr.emp_pkey = pr.hierarch
     WHERE pr.approved_status = ? AND pr.status = 1
     ORDER BY pr.promotion_pkey DESC`,
    [status]
  );

  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);
  const today = new Date().toISOString().slice(0, 10);

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO promotions
       (emp_fkey, created_date, approved_by, approved_status, approved_date, designation, emp_type,
        emp_dept, emp_branch, shift, \`leave\`, annual_gross, hierarch, salary, remarks,
        promotion_status, created_by, status)
     VALUES (?, ?, 0, 'N', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPLIED', ?, 1)`,
    [
      body.emp_fkey, today, today,
      body.designation ?? '', body.emp_type ?? '', body.emp_dept ?? '', body.emp_branch ?? '',
      body.shift ?? '', body.leave ?? '', body.annual_gross ?? '', body.hierarch ?? '', body.salary ?? '',
      body.remarks ?? '', session.user.loginUserId,
    ]
  );

  return NextResponse.json({ promotion_pkey: result.insertId }, { status: 201 });
}

// Edit a still-pending request. Legacy's savepromotions() re-saves by primary key; here we only
// allow it while approved_status is still 'N' (nothing has cascaded onto the employee yet).
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const promotionPkey = Number(body.promotion_pkey);
  if (!promotionPkey) {
    return NextResponse.json({ error: 'promotion_pkey is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [[promo]] = await pool.execute<RowDataPacket[]>(
    'SELECT approved_status FROM promotions WHERE promotion_pkey = ? AND status = 1',
    [promotionPkey]
  );
  if (!promo) return NextResponse.json({ error: 'Promotion request not found' }, { status: 404 });
  if (promo.approved_status !== 'N') {
    return NextResponse.json({ error: 'This request has already been processed and can no longer be edited' }, { status: 409 });
  }

  await pool.execute(
    `UPDATE promotions SET designation = ?, emp_type = ?, emp_dept = ?, emp_branch = ?, shift = ?,
        \`leave\` = ?, annual_gross = ?, hierarch = ?, salary = ?, remarks = ?
     WHERE promotion_pkey = ?`,
    [
      body.designation ?? '', body.emp_type ?? '', body.emp_dept ?? '', body.emp_branch ?? '',
      body.shift ?? '', body.leave ?? '', body.annual_gross ?? '', body.hierarch ?? '', body.salary ?? '',
      body.remarks ?? '', promotionPkey,
    ]
  );

  return NextResponse.json({ success: true });
}
