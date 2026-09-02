import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import * as XLSX from 'xlsx';
import { generateNextEmpId } from '@/lib/empId';

// Mirrors legacy DataUploaderController::uploadandsaveempdetails($emp_branch): direct writes to
// emp_details/emp_proff/user_credentials, NOT routed through the emp_join staging table (that's
// Employee Join's job, a separate feature). One branch applies to the whole uploaded file.
// Legacy's duplicate check is weak (first_name+last_name+date_of_birth only) — we use the
// stronger PAN/Aadhaar check already used by Add Employee and Employee Join, which is strictly
// safer and consistent with the rest of this app, not a functional gap against legacy.

function str(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return s || null;
}

// Excel stores date-formatted cells as a numeric serial, not text — sheet_to_json returns that
// raw number (e.g. 36130) unless the cell happens to be formatted as plain text. String(36130)
// is a value that passes every "is this present" check but is not a real date, and MySQL's
// strict mode rejects it outright (ER_TRUNCATED_WRONG_VALUE) rather than silently coercing it.
function excelDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value);
    if (!date) return null;
    return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
  }
  const s = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('file');
  const branchCode = str(formData.get('branch'));
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  if (!branchCode) {
    return NextResponse.json({ error: 'A branch must be selected for this import' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const pool = await getCompanyPool(session.user.companyCode);

  const [designations] = await pool.execute<RowDataPacket[]>(
    "SELECT desig_code, desig_name FROM designation WHERE status = 1"
  );
  const desigByName = new Map(designations.map((d) => [String(d.desig_name).trim().toLowerCase(), d.desig_code]));

  const [departments] = await pool.execute<RowDataPacket[]>(
    "SELECT dept_code, dept_name FROM department WHERE status = 1"
  );
  const deptByName = new Map(departments.map((d) => [String(d.dept_name).trim().toLowerCase(), d.dept_code]));

  const [grades] = await pool.execute<RowDataPacket[]>(
    "SELECT grade_code, grade_name FROM grade WHERE status = 1"
  );
  const gradeByName = new Map(grades.map((g) => [String(g.grade_name).trim().toLowerCase(), g.grade_code]));

  const errors: { row: number; message: string }[] = [];
  let inserted = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const firstName = str(row['First Name *']);
    const dob = excelDate(row['Date of Birth * (yyyy-mm-dd)']);
    const joiningDate = excelDate(row['Joining Date * (yyyy-mm-dd)']);
    const empType = str(row['Employee Type *']);
    const desigName = str(row['Designation *']);
    const deptName = str(row['Department *']);
    // Gender is mandatory in legacy's Add Employee (Personal Info tab) — mirror that for imports too.
    const genderRawReq = str(row['Gender *']) ?? str(row['Gender']);

    if (!firstName || !dob || !joiningDate || !empType || !desigName || !deptName || !genderRawReq) {
      errors.push({ row: rowNum, message: 'Missing a required field (First Name, Date of Birth, Joining Date, Employee Type, Designation, Department, or Gender)' });
      continue;
    }

    const desigCode = desigByName.get(desigName.toLowerCase());
    if (!desigCode) {
      errors.push({ row: rowNum, message: `Unrecognized designation: "${desigName}"` });
      continue;
    }
    const deptCode = deptByName.get(deptName.toLowerCase());
    if (!deptCode) {
      errors.push({ row: rowNum, message: `Unrecognized department: "${deptName}"` });
      continue;
    }
    const gradeName = str(row['Grade']);
    const gradeCode = gradeName ? gradeByName.get(gradeName.toLowerCase()) : null;
    if (gradeName && !gradeCode) {
      errors.push({ row: rowNum, message: `Unrecognized grade: "${gradeName}"` });
      continue;
    }

    const aadhaar = str(row['Aadhaar No']);
    const panNo = str(row['PAN No']);
    if (aadhaar || panNo) {
      const dupConditions: string[] = [];
      const dupParams: string[] = [];
      if (aadhaar) { dupConditions.push('id_card = ?'); dupParams.push(aadhaar); }
      if (panNo) { dupConditions.push('pan_no = ?'); dupParams.push(panNo); }
      const [dup] = await pool.execute<RowDataPacket[]>(
        `SELECT 1 FROM emp_details WHERE status = 1 AND (${dupConditions.join(' OR ')})`,
        dupParams
      );
      if (dup.length) {
        errors.push({ row: rowNum, message: 'An active employee already exists with this Aadhaar No or PAN No' });
        continue;
      }
    }

    const genderRaw = genderRawReq.toLowerCase();
    const classification = genderRaw.startsWith('m') ? 'male' : genderRaw.startsWith('f') ? 'female' : 'others';
    const lastName = str(row['Last Name']);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const empId = await generateNextEmpId(connection);

      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO emp_details
           (company_code, branch_code, emp_id, first_name, last_name, date_of_birth, mobile_no, email,
            classification, id_card, pan_no, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          session.user.companyCode, branchCode, empId, firstName, lastName, dob,
          str(row['Mobile Number']), str(row['Email Address']), classification, aadhaar, panNo,
        ]
      );
      const empPkey = result.insertId;

      await connection.execute(
        `INSERT INTO emp_proff (emp_fkey, joining_date, emp_branch, emp_dept, designation, emp_grade, emp_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [empPkey, joiningDate, branchCode, deptCode, desigCode, gradeCode ?? null, empType]
      );

      // No login created at import time — blank user_id/password matches legacy's
      // uploadandsaveempdetails(); NULL (not '') avoids colliding on user_id's UNIQUE constraint
      // across multiple imported rows. HR can enable a login later via User Access.
      await connection.execute(
        `INSERT INTO user_credentials
           (emp_fkey, company_code, user_id, password, access_allowed, first_name, last_name, email,
            reset_login_flag, locked, incorrect_login_attempt, user_group)
         VALUES (?, ?, NULL, NULL, 'n', ?, ?, ?, 'N', 0, 0, 1)`,
        [empPkey, session.user.companyCode, firstName, lastName, str(row['Email Address'])]
      );

      await connection.commit();
      inserted++;
    } catch (err) {
      await connection.rollback();
      errors.push({ row: rowNum, message: err instanceof Error ? err.message : 'Failed to save this row' });
    } finally {
      connection.release();
    }
  }

  return NextResponse.json({ success: true, inserted, errors });
}
