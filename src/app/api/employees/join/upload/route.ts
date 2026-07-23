import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import * as XLSX from 'xlsx';

function yn(value: unknown): string {
  return String(value ?? '').trim().toLowerCase() === 'yes' ? 'Y' : 'N';
}

function str(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return s || null;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const pool = await getCompanyPool(session.user.companyCode);

  const [nationalityRows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, country_name FROM countries_nationality'
  );
  const nationalityByName = new Map(
    nationalityRows.map((n) => [String(n.country_name).trim().toLowerCase(), n.id as number])
  );

  const errors: { row: number; message: string }[] = [];
  let inserted = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // header row is line 1

    const name = str(row['Name *']);
    const birthDate = str(row['Birth Date * (yyyy-mm-dd)']);
    const gender = str(row['Gender *']);
    const nationalityName = str(row['Nationality *']);
    const aadhaar = str(row['Aadhaar No *']);

    if (!name || !birthDate || !gender || !nationalityName || !aadhaar) {
      errors.push({ row: rowNum, message: 'Missing a required field (Name, Birth Date, Gender, Nationality, or Aadhaar No)' });
      continue;
    }

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

    const nationalityId = nationalityByName.get(nationalityName.toLowerCase());
    if (!nationalityId) {
      errors.push({ row: rowNum, message: `Unrecognized nationality: "${nationalityName}"` });
      continue;
    }
    const countryOfOriginName = str(row['Country of Origin']);
    const countryOriginId = countryOfOriginName ? nationalityByName.get(countryOfOriginName.toLowerCase()) : null;

    const [firstName, ...rest] = name.split(' ');
    const lastName = rest.join(' ') || null;

    const genderValue = gender.toLowerCase().startsWith('m') ? 'male' : gender.toLowerCase().startsWith('f') ? 'female' : 'others';

    await pool.execute(
      `INSERT INTO emp_join
         (emp_fkey, status, first_name, last_name, date_of_birth, classification, email, mobile_no,
          address, pincode, nationality_id, state, district, maritual_status, guradian, relation_guardian,
          blood, id_card, pan_no, bank, bank_branch, ifsc_code, account_no, esi, esi_dispensary, pf,
          company_pf, previous_member_id, wps_code, lwf_code, eps, physical_handicap,
          international_worker, country_origin, locomotive, hearing, visual)
       VALUES (0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        firstName, lastName, birthDate, genderValue, str(row['Email Address']), str(row['Phone Number']),
        str(row['Address']), str(row['Pin Code']), nationalityId, str(row['State']), str(row['District']),
        str(row['Marital Status']), str(row['Guardian Name']), str(row['Relation']), str(row['Blood Group']),
        aadhaar, panNo, str(row['Bank Name']), str(row['Branch']), str(row['IFSC Code']), str(row['Account Number']),
        str(row['ESI No']), str(row['ESI Dispensary']), str(row['PF No']), str(row['UAN No']),
        str(row['Previous Member ID']), str(row['WPS ID']), str(row['LWF Registration No']),
        yn(row['EPS Eligibility (Yes/No)']), yn(row['Physical Handicap (Yes/No)']),
        yn(row['International Worker (Yes/No)']), countryOriginId ?? null,
        yn(row['Locomotive (Yes/No)']), yn(row['Hearing (Yes/No)']), yn(row['Visual (Yes/No)']),
      ]
    );
    inserted++;
  }

  return NextResponse.json({ success: true, inserted, errors });
}
