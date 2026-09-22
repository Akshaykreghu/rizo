import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { dobError, ageAtDateError, statutoryFieldErrors } from '@/lib/validation';

// The edit form submits blank optional fields as '', not undefined — `x ?? null` leaves those
// as '', which MySQL rejects for DATE / INT columns (e.g. date_of_birth, attr1) under strict
// mode and 500s the request. Normalise '' to null before binding.
const nn = (v: unknown): string | number | null =>
  v === '' || v == null ? null : (v as string | number);

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
  const pool = await getCompanyPool(session.user.companyCode);

  if (body.status !== undefined) {
    if (body.status !== 1 && body.status !== 0) {
      return NextResponse.json(
        { error: 'status must be 1 (active) or 0 (inactive) — status 2 (resigned) is set only by the Resignation workflow' },
        { status: 400 }
      );
    }
    await pool.execute('UPDATE emp_details SET status = ? WHERE emp_pkey = ?', [body.status, id]);
  }

  // Ports legacy Employee::updateEditable() — simplified from legacy's 3-checkbox (Personal/
  // Other/Onboarding) section-level lock to a single record-wide lock, since this page isn't
  // split into those same legacy form fragments. A record locks itself on onboarding (editable=0,
  // see join/[id]/onboard/route.ts) until an admin explicitly flips this switch.
  if (body.editable !== undefined) {
    if (body.editable !== 1 && body.editable !== 0) {
      return NextResponse.json({ error: 'editable must be 1 (unlocked) or 0 (locked)' }, { status: 400 });
    }
    await pool.execute('UPDATE emp_details SET editable = ? WHERE emp_pkey = ?', [body.editable, id]);
  }

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
              lpg.LEAVEPOLICY_GROUP_NAME AS leave_policy_group_name,
              nat.nationality AS nationality_name, cty.country_name AS country_name
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
       LEFT JOIN countries_nationality nat ON nat.id = e.nationality_id
       LEFT JOIN countries_nationality cty ON cty.id = e.country
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
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const empPkey = parseInt(id);
  const isAdmin = session.user.userGroup === 1;

  // Employees can edit their own personal/contact/banking/statutory details (New Rizo's ESS
  // "About Me" edit form), but never their own professional record — see the emp_proff guard
  // below, which is skipped entirely for a self-edit regardless of what the body contains.
  if (!isAdmin && session.user.empFkey !== empPkey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);

  // Aadhaar is mandatory on every save, even one that doesn't touch id_card — a row with no
  // Aadhaar can't be saved until one is entered (decision 2026-09-07).
  let finalIdCard: string | null = body.id_card ?? null;
  if (body.id_card === undefined) {
    const [current] = await pool.execute<RowDataPacket[]>(
      'SELECT id_card FROM emp_details WHERE emp_pkey = ?',
      [empPkey]
    );
    finalIdCard = current[0]?.id_card ?? null;
  }

  const validationError =
    (body.first_name !== undefined && !body.first_name?.trim() ? 'First name is required' : null) ||
    (body.classification !== undefined && !body.classification ? 'Gender is required' : null) ||
    (body.date_of_birth !== undefined
      ? (body.date_of_birth ? dobError(body.date_of_birth) : 'Date of birth is required')
      : null) ||
    (!finalIdCard ? 'Aadhaar/ID Card is required' : null) ||
    statutoryFieldErrors(body) ||
    (body.date_of_birth && body.joining_date ? ageAtDateError(body.date_of_birth, body.joining_date) : null);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(
      `UPDATE emp_details SET
         first_name = ?, last_name = ?, date_of_birth = ?, mobile_no = ?, email = ?,
         classification = ?, blood = ?, maritual_status = ?, profile_pic = ?,
         id_card = ?, lwf_code = ?,
         pan_no = ?, pf = ?, company_pf = ?, eps = ?, esi = ?, esi_dispensary = ?,
         bank_name = ?, branch_name = ?, branch_address = ?, ifsc_code = ?, account_no = ?,
         address = ?, city = ?, state = ?, pincode = ?, guradian = ?, relation_guardian = ?,
         international_worker = ?, country = ?, physical_handicap = ?, locomotive = ?, hearing = ?, visual = ?,
         wps_code = ?, previous_member_id = ?
       WHERE emp_pkey = ?`,
      [
        body.first_name, body.last_name, nn(body.date_of_birth),
        nn(body.mobile_no), nn(body.email),
        nn(body.classification), nn(body.blood), nn(body.maritual_status), nn(body.profile_pic),
        nn(body.id_card), nn(body.lwf_code),
        nn(body.pan_no), nn(body.pf), nn(body.company_pf),
        nn(body.eps), nn(body.esi), nn(body.esi_dispensary),
        nn(body.bank_name), nn(body.bank_branch_name), nn(body.branch_address),
        nn(body.ifsc_code), nn(body.account_no),
        nn(body.address), nn(body.district), nn(body.state), nn(body.pincode),
        nn(body.guradian), nn(body.relation_guardian),
        nn(body.international_worker), nn(body.country), nn(body.physical_handicap),
        nn(body.locomotive), nn(body.hearing), nn(body.visual),
        nn(body.wps_code), nn(body.previous_member_id),
        empPkey,
      ]
    );

    // Department, designation, grade, shift, branch, joining date and reporting structure are
    // HR-managed and never touched by a self-edit — New Rizo shows these as a locked "Official"
    // section on ESS About Me, and this skip is what actually enforces that server-side.
    if (isAdmin) {
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
            nn(body.joining_date), nn(body.emp_branch), nn(body.emp_dept),
            nn(body.designation), nn(body.emp_grade),
            nn(body.emp_type), body.attr1 ? Number(body.attr1) : null,
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
            empPkey, nn(body.joining_date), nn(body.emp_branch), nn(body.emp_dept),
            nn(body.designation), nn(body.emp_grade), nn(body.emp_type), body.attr1 ? Number(body.attr1) : null,
            body.probation ? Number(body.probation) : null,
            body.day_time_seq ? Number(body.day_time_seq) : null,
            body.holiday_group_id ? Number(body.holiday_group_id) : null,
            body.leavepolicy_group_id ? Number(body.leavepolicy_group_id) : null,
          ]
        );
      }
    }

    await connection.commit();
    return NextResponse.json({ success: true });
  } catch (err) {
    await connection.rollback();
    console.error('PUT /api/employees/[id] failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update employee' },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
