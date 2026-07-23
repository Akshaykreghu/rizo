import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { generateNextEmpId } from '@/lib/empId';

const LIST_SELECT = `
  SELECT e.emp_pkey, e.emp_id, e.first_name, e.last_name, e.status,
         e.mobile_no, e.email, e.date_of_birth,
         p.joining_date, p.emp_branch, p.emp_dept, p.designation,
         b.branch_name, d.dept_name, ds.desig_name
  FROM emp_details e
  LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
  LEFT JOIN branches b ON b.branch_code = p.emp_branch
  LEFT JOIN department d ON d.dept_code = p.emp_dept
  LEFT JOIN designation ds ON ds.desig_code = p.designation
`;

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1);
  const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') ?? '25') || 25);
  const search = searchParams.get('search') ?? '';
  const branch = searchParams.get('branch') ?? '';
  const status = searchParams.get('status') ?? '1';
  const offset = (page - 1) * pageSize;

  // Employees can only see themselves
  if (session.user.userGroup !== 1) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `${LIST_SELECT} WHERE e.emp_pkey = ?`,
      [session.user.empFkey]
    );
    return NextResponse.json({ data: rows, total: rows.length });
  }

  const conditions: string[] = ['e.status = ?'];
  const statusValue = Number.isNaN(Number(status)) ? 1 : Number(status);
  const params: (string | number)[] = [statusValue];

  if (search) {
    conditions.push('(e.first_name LIKE ? OR e.last_name LIKE ? OR e.emp_id LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (branch) {
    conditions.push('p.emp_branch = ?');
    params.push(branch);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [[countRow], [rows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM emp_details e LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey ${where}`,
      params
    ),
    pool.execute<RowDataPacket[]>(
      `${LIST_SELECT} ${where} ORDER BY e.first_name, e.last_name LIMIT ${pageSize} OFFSET ${offset}`,
      params
    ),
  ]);

  return NextResponse.json({ data: rows, total: countRow[0]?.total ?? 0 });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);

  // Duplicate check (mirrors legacy EmployeeController.php:3195-3221)
  if (body.id_card || body.lwf_code || body.emp_id) {
    const dupConditions: string[] = [];
    const dupParams: string[] = [];
    if (body.id_card) { dupConditions.push('id_card = ?'); dupParams.push(body.id_card); }
    if (body.lwf_code) { dupConditions.push('lwf_code = ?'); dupParams.push(body.lwf_code); }
    if (body.emp_id) { dupConditions.push('emp_id = ?'); dupParams.push(body.emp_id); }
    const [dup] = await pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM emp_details WHERE (${dupConditions.join(' OR ')})`,
      dupParams
    );
    if (dup.length) {
      return NextResponse.json({ error: 'An employee with this Employee ID, ID Card, or LWF Code already exists' }, { status: 409 });
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const empId = body.emp_id || (await generateNextEmpId(connection));

    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO emp_details
         (company_code, branch_code, emp_id, first_name, last_name, date_of_birth, mobile_no, email,
          classification, blood, maritual_status, profile_pic, id_card, lwf_code,
          pan_no, name_as_on_pan, pf, company_pf, eps, esi, esi_dispensary,
          bank_name, branch_name, branch_address, name_as_per_bank, ifsc_code, account_no,
          status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        session.user.companyCode,
        body.emp_branch ?? '',
        empId,
        body.first_name,
        body.last_name,
        body.date_of_birth ?? null,
        body.mobile_no ?? null,
        body.email ?? null,
        body.classification ?? null,
        body.blood ?? null,
        body.maritual_status ?? null,
        body.profile_pic ?? null,
        body.id_card ?? null,
        body.lwf_code ?? null,
        body.pan_no ?? null,
        body.name_as_on_pan ?? null,
        body.pf ?? null,
        body.company_pf ?? null,
        body.eps ?? null,
        body.esi ?? null,
        body.esi_dispensary ?? null,
        body.bank_name ?? null,
        body.bank_branch_name ?? null,
        body.branch_address ?? null,
        body.name_as_per_bank ?? null,
        body.ifsc_code ?? null,
        body.account_no ?? null,
      ]
    );

    const empPkey = result.insertId;

    if (body.joining_date || body.emp_branch || body.emp_dept || body.designation || body.emp_grade) {
      await connection.execute(
        `INSERT INTO emp_proff
           (emp_fkey, joining_date, emp_branch, emp_dept, designation, emp_grade, emp_type, attr1, probation, structure_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          empPkey,
          body.joining_date ?? null,
          body.emp_branch ?? null,
          body.emp_dept ?? null,
          body.designation ?? null,
          body.emp_grade ?? null,
          body.emp_type ?? null,
          body.attr1 ?? null,
          body.probation ? Number(body.probation) : null,
          body.structure_id ? Number(body.structure_id) : null,
        ]
      );
    }

    if (body.emp_anual_ctc) {
      await connection.execute(
        `INSERT INTO emp_ctc_upload
           (emp_fkey, emp_anual_ctc, emp_monthly_ctc, created_by, start_date_effective)
         VALUES (?, ?, ?, ?, ?)`,
        [
          empPkey,
          Number(body.emp_anual_ctc),
          body.emp_monthly_ctc ? Number(body.emp_monthly_ctc) : null,
          session.user.loginUserId,
          body.joining_date || new Date().toISOString().slice(0, 10),
        ]
      );
    }

    await connection.commit();
    return NextResponse.json({ emp_pkey: empPkey }, { status: 201 });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
