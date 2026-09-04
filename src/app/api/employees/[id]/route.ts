import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  if (body.status !== 1 && body.status !== 0) {
    return NextResponse.json(
      { error: 'status must be 1 (active) or 0 (inactive) — status 2 (resigned) is set only by the Resignation workflow' },
      { status: 400 }
    );
  }

  const pool = await getCompanyPool(session.user.companyCode);
  await pool.execute('UPDATE emp_details SET status = ? WHERE emp_pkey = ?', [body.status, id]);
  return NextResponse.json({ success: true });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const empPkey = parseInt(id);

  // Employees can only view themselves
  if (session.user.userGroup !== 1 && session.user.empFkey !== empPkey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [[empRows], [proffRows], [ctcRows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT e.*, b.branch_name AS emp_branch_name, d.dept_name, ds.desig_name, g.grade_name,
              m.first_name AS manager_first_name, m.last_name AS manager_last_name,
              wdtp.day_time_desc AS shift_name, hg.HOLIDAY_GROUP_NAME AS holiday_group_name,
              lpg.LEAVEPOLICY_GROUP_NAME AS leave_policy_group_name
       FROM emp_details e
       LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
       LEFT JOIN branches b ON b.branch_code = p.emp_branch
       LEFT JOIN department d ON d.dept_code = p.emp_dept
       LEFT JOIN designation ds ON ds.desig_code = p.designation
       LEFT JOIN grade g ON g.grade_code = p.emp_grade
       LEFT JOIN emp_details m ON m.emp_pkey = p.attr1
       LEFT JOIN working_day_time_procedures wdtp ON wdtp.day_time_seq = p.day_time_seq
       LEFT JOIN holiday_group hg ON hg.HOLIDAY_GROUP_ID = p.HOLIDAY_GROUP_ID
       LEFT JOIN leavepolicy_group lpg ON lpg.LEAVEPOLICY_GROUP_ID = p.LEAVEPOLICY_GROUP_ID
       WHERE e.emp_pkey = ?`,
      [empPkey]
    ),
    pool.execute<RowDataPacket[]>(
      'SELECT * FROM emp_proff WHERE emp_fkey = ?',
      [empPkey]
    ),
    pool.execute<RowDataPacket[]>(
      'SELECT * FROM emp_ctc_upload WHERE emp_fkey = ? AND status = 1 ORDER BY emp_ctc_upload_pkey DESC LIMIT 1',
      [empPkey]
    ),
  ]);

  if (!empRows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    employee: empRows[0],
    professional: proffRows[0] ?? null,
    ctc: ctcRows[0] ?? null,
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const empPkey = parseInt(id);
  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(
      `UPDATE emp_details SET
         first_name = ?, last_name = ?, date_of_birth = ?, mobile_no = ?, email = ?,
         classification = ?, blood = ?, maritual_status = ?, profile_pic = ?,
         id_card = ?, lwf_code = ?,
         pan_no = ?, name_as_on_pan = ?, pf = ?, company_pf = ?, eps = ?, esi = ?, esi_dispensary = ?,
         bank_name = ?, branch_name = ?, branch_address = ?, name_as_per_bank = ?, ifsc_code = ?, account_no = ?
       WHERE emp_pkey = ?`,
      [
        body.first_name, body.last_name, body.date_of_birth ?? null,
        body.mobile_no ?? null, body.email ?? null,
        body.classification ?? null, body.blood ?? null, body.maritual_status ?? null, body.profile_pic ?? null,
        body.id_card ?? null, body.lwf_code ?? null,
        body.pan_no ?? null, body.name_as_on_pan ?? null, body.pf ?? null, body.company_pf ?? null,
        body.eps ?? null, body.esi ?? null, body.esi_dispensary ?? null,
        body.bank_name ?? null, body.bank_branch_name ?? null, body.branch_address ?? null,
        body.name_as_per_bank ?? null, body.ifsc_code ?? null, body.account_no ?? null,
        empPkey,
      ]
    );

    const [existingProff] = await connection.execute<RowDataPacket[]>(
      'SELECT emp_fkey FROM emp_proff WHERE emp_fkey = ?',
      [empPkey]
    );

    // Salary structure and CTC are not edited from the employee form — matching legacy, they
    // are managed via Bulk Policies -> Salary and the CTC-upload step. emp_proff.structure_id
    // is left to its emp_config trigger.
    if (existingProff.length) {
      await connection.execute(
        `UPDATE emp_proff SET
           joining_date = ?, emp_branch = ?, emp_dept = ?, designation = ?, emp_grade = ?,
           emp_type = ?, attr1 = ?, probation = ?, day_time_seq = ?,
           HOLIDAY_GROUP_ID = ?, LEAVEPOLICY_GROUP_ID = ?
         WHERE emp_fkey = ?`,
        [
          body.joining_date ?? null, body.emp_branch ?? null, body.emp_dept ?? null,
          body.designation ?? null, body.emp_grade ?? null,
          body.emp_type ?? null, body.attr1 ?? null,
          body.probation ? Number(body.probation) : null,
          body.day_time_seq ? Number(body.day_time_seq) : null,
          body.holiday_group_id ? Number(body.holiday_group_id) : null,
          body.leavepolicy_group_id ? Number(body.leavepolicy_group_id) : null,
          empPkey,
        ]
      );
    } else {
      await connection.execute(
        `INSERT INTO emp_proff
           (emp_fkey, joining_date, emp_branch, emp_dept, designation, emp_grade, emp_type, attr1, probation, day_time_seq, HOLIDAY_GROUP_ID, LEAVEPOLICY_GROUP_ID)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          empPkey, body.joining_date ?? null, body.emp_branch ?? null, body.emp_dept ?? null,
          body.designation ?? null, body.emp_grade ?? null, body.emp_type ?? null, body.attr1 ?? null,
          body.probation ? Number(body.probation) : null,
          body.day_time_seq ? Number(body.day_time_seq) : null,
          body.holiday_group_id ? Number(body.holiday_group_id) : null,
          body.leavepolicy_group_id ? Number(body.leavepolicy_group_id) : null,
        ]
      );
    }

    await connection.commit();
    return NextResponse.json({ success: true });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
