import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import bcrypt from 'bcryptjs';
import { generateNextEmpId } from '@/lib/empId';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const rawBody = (await request.json()) as Record<string, string | undefined>;
  // Frontend form fields default to '' rather than null/undefined, which `??` doesn't catch —
  // blank out to null so optional DATE/numeric columns (joining_date, probation, structure_id,
  // emp_anual_ctc, emp_monthly_ctc) don't hit MySQL's strict-mode ER_TRUNCATED_WRONG_VALUE.
  const body = Object.fromEntries(
    Object.entries(rawBody).map(([k, v]) => [k, v === '' ? null : v])
  ) as Record<string, string | null>;
  const pool = await getCompanyPool(session.user.companyCode);

  const [joinRows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM emp_join WHERE emp_join_pkey = ? AND status = 1',
    [id]
  );
  if (!joinRows.length) {
    return NextResponse.json({ error: 'Join record not found or already onboarded' }, { status: 404 });
  }
  const join = joinRows[0];

  if (!body.username || !body.password) {
    return NextResponse.json(
      { error: 'Username and password are required' },
      { status: 400 }
    );
  }

  // Duplicate checks — mirrors legacy saveonboarding() (EmployeeJoinController.php:10622)
  const dupChecks: { column: string; value: string | null }[] = [
    { column: 'pan_no', value: join.pan_no },
    { column: 'id_card', value: join.id_card },
    { column: 'esi', value: join.esi },
    { column: 'company_pf', value: join.pf }, // UAN maps from join.pf due to the field swap
    { column: 'lwf_code', value: join.lwf_code },
    { column: 'account_no', value: join.account_no },
  ].filter((c) => c.value);

  if (dupChecks.length) {
    const conditions = dupChecks.map((c) => `${c.column} = ?`).join(' OR ');
    const [dup] = await pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM emp_details WHERE status = 1 AND (${conditions})`,
      dupChecks.map((c) => c.value)
    );
    if (dup.length) {
      return NextResponse.json({ error: 'An active employee already exists with matching PAN/Aadhaar/ESI/UAN/LWF/account number' }, { status: 409 });
    }
  }

  const dupChecksPromises: Promise<[RowDataPacket[], unknown]>[] = [
    pool.execute<RowDataPacket[]>('SELECT 1 FROM emp_proff WHERE emp_company_id = ?', [body.emp_company_id]),
    pool.execute<RowDataPacket[]>('SELECT 1 FROM user_credentials WHERE user_id = ?', [body.username]),
  ];
  if (body.emp_id) {
    dupChecksPromises.push(pool.execute<RowDataPacket[]>('SELECT 1 FROM emp_details WHERE emp_id = ?', [body.emp_id]));
  }
  const [[dupCompanyId], [dupUsername], dupEmpIdResult] = await Promise.all(dupChecksPromises);
  if (dupCompanyId.length) return NextResponse.json({ error: 'Employee Company ID already in use' }, { status: 409 });
  if (dupUsername.length) return NextResponse.json({ error: 'Username already in use' }, { status: 409 });
  if (dupEmpIdResult && (dupEmpIdResult[0] as RowDataPacket[]).length) {
    return NextResponse.json({ error: 'Employee ID already in use' }, { status: 409 });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const empId = body.emp_id || (await generateNextEmpId(connection));

    const [empResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO emp_details
         (company_code, branch_code, emp_id, first_name, last_name, date_of_birth, mobile_no, email,
          address, city, state, nationality_id, pincode, maritual_status, blood, classification,
          guradian, relation_guardian, id_card, pan_no, wps_code, lwf_code, esi_dispensary, esi, eps,
          international_worker, physical_handicap, locomotive, hearing, visual,
          bank_name, branch_name, ifsc_code, account_no, pf, company_pf,
          profile_pic, status, editable, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
      [
        session.user.companyCode, body.emp_branch ?? '', empId,
        join.first_name, join.last_name, join.date_of_birth, join.mobile_no, join.email,
        join.address, join.district ?? null, join.state, join.nationality_id, join.pincode,
        join.maritual_status, join.blood, join.classification,
        join.guradian, join.relation_guardian, join.id_card, join.pan_no, join.wps_code,
        join.lwf_code, join.esi_dispensary, join.esi, join.eps,
        join.international_worker, join.physical_handicap, join.locomotive, join.hearing, join.visual,
        join.bank, join.bank_branch, join.ifsc_code, join.account_no,
        join.company_pf, join.pf, // swapped per legacy quirk: emp_details.pf <- join.company_pf, emp_details.company_pf <- join.pf
        join.profile_image_url ?? null,
        session.user.loginUserId,
      ]
    );
    const empPkey = empResult.insertId;

    await connection.execute(
      `INSERT INTO emp_proff
         (emp_fkey, joining_date, emp_company_id, emp_type, designation, emp_dept, emp_grade,
          emp_branch, attr1, probation, structure_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empPkey, body.joining_date ?? null, body.emp_company_id, body.emp_type ?? null,
        body.designation ?? null, body.emp_dept ?? null, body.emp_grade ?? null,
        body.emp_branch ?? null, body.attr1 ?? null,
        body.probation ? Number(body.probation) : null,
        body.structure_id ? Number(body.structure_id) : null,
        session.user.loginUserId,
      ]
    );

    if (body.emp_anual_ctc) {
      await connection.execute(
        `INSERT INTO emp_ctc_upload (emp_fkey, emp_anual_ctc, emp_monthly_ctc, created_by, start_date_effective)
         VALUES (?, ?, ?, ?, ?)`,
        [
          empPkey, Number(body.emp_anual_ctc),
          body.emp_monthly_ctc ? Number(body.emp_monthly_ctc) : null,
          session.user.loginUserId,
          body.joining_date || new Date().toISOString().slice(0, 10),
        ]
      );
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    await connection.execute(
      `INSERT INTO user_credentials
         (emp_fkey, company_code, user_id, password, access_allowed, first_name, last_name, email,
          reset_login_flag, locked, incorrect_login_attempt, user_group)
       VALUES (?, ?, ?, ?, 'n', ?, ?, ?, 'N', 0, 0, 1)`,
      [empPkey, session.user.companyCode, body.username, passwordHash, join.first_name, join.last_name, join.email]
    );

    await connection.execute(
      'UPDATE emp_join SET status = 0, emp_fkey = ? WHERE emp_join_pkey = ?',
      [empPkey, id]
    );

    await connection.execute(
      `INSERT INTO qualifcations (emp_fkey, course, university, duration, mark, status)
       SELECT ?, course, university, duration, mark, 1 FROM education WHERE emp_join_fkey = ? AND status = 1`,
      [empPkey, id]
    );
    await connection.execute(
      `INSERT INTO history (emp_fkey, company, from_date, to_date, designation, department, salary, status)
       SELECT ?, company, from_date, to_date, designation, department, salary, 1 FROM work_experience WHERE emp_join_fkey = ? AND status = 1`,
      [empPkey, id]
    );
    await connection.execute(
      `INSERT INTO emp_family
         (emp_fkey, name, DOB, gender, blood_group, relation, nationality, contact_number,
          alternate_number, emergency_contact, remarks, is_nominee, created_by, status)
       SELECT ?, name, DOB, gender, blood_group, relation, nationality, contact_number,
              alternate_number, emergency_contact, remarks, is_nominee, created_by, 1
       FROM family WHERE emp_join_fkey = ? AND status = 'Y'`,
      [empPkey, id]
    );
    await connection.execute(
      `INSERT INTO emp_passport_visa
         (emp_fkey, document_type, document_number, classification, name, relation, valid_from,
          valid_till, nationality, remarks, files, created_by, status)
       SELECT ?, document_type, document_number, classification, name, relation, valid_from,
              valid_till, nationality, remarks, files, created_by, 1
       FROM emp_documents WHERE emp_join_fkey = ? AND status = 1`,
      [empPkey, id]
    );

    await connection.commit();
    return NextResponse.json({ emp_pkey: empPkey }, { status: 201 });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
