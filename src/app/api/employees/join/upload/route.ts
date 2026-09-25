import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import * as XLSX from 'xlsx';
import { dobError, emailError, mobileError, statutoryFieldErrors } from '@/lib/validation';
import { EMPLOYEE_FIELD_LIMITS } from '@/lib/employeeFieldLimits';

// Employee Join bulk upload — ports legacy EmployeeJoinController::uploadandsaveempdetail() (the
// live action behind View/EmployeeJoin/index.ctp's "Upload file"), validated with the same rules
// the Employee Join form enforces (lib/validation.ts + lib/employeeFieldLimits.ts). Every row is
// checked on its own: a bad row is reported and skipped, it never aborts the rest of the file.

const VALID_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed'];

function yn(value: unknown): 'Y' | 'N' {
  const v = String(value ?? '').trim().toLowerCase();
  return v === 'yes' || v === 'y' || v === 'on' ? 'Y' : 'N';
}

// Excel turns long numbers (Aadhaar, account no) into numeric cells, which can come back in
// exponent form — legacy fixScientific(). Plain strings are just trimmed.
function str(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? BigInt(Math.round(value)).toString() : String(value);
  }
  return String(value ?? '').trim();
}

// legacy titleCase(): "JOHN doe" -> "John Doe"
const titleCase = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());

const pad = (n: number) => String(n).padStart(2, '0');

// Birth date as an Excel date cell (numeric serial) or text in yyyy-mm-dd, dd-mm-yyyy,
// dd/mm/yyyy or yyyy/mm/dd — the formats legacy accepts. Returns yyyy-mm-dd, or null if it isn't
// a real calendar date.
function parseDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  let y: number, m: number, d: number;
  if (typeof value === 'number') {
    const p = XLSX.SSF.parse_date_code(value);
    if (!p) return null;
    ({ y, m, d } = p);
  } else {
    const s = String(value).trim();
    let match = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (match) { y = +match[1]; m = +match[2]; d = +match[3]; }
    else {
      match = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
      if (!match) return null;
      d = +match[1]; m = +match[2]; y = +match[3];
    }
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function normalizeGender(g: string): 'male' | 'female' | 'others' | null {
  const v = g.trim().toLowerCase();
  if (v === 'm' || v === 'male') return 'male';
  if (v === 'f' || v === 'female') return 'female';
  if (v === 'o' || v === 'other' || v === 'others') return 'others';
  return null;
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

  let rows: Record<string, unknown>[];
  try {
    const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  } catch {
    return NextResponse.json({ error: 'Could not read the file — upload the .xlsx template' }, { status: 400 });
  }
  if (rows.length && !('Name *' in rows[0] && 'Aadhaar No *' in rows[0])) {
    return NextResponse.json({ error: 'This file does not match the template — download the template and fill it in' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  // Nationality by country name ("India") or nationality ("Indian"), like legacy's $countryMap.
  const [nationalityRows] = await pool.execute<RowDataPacket[]>('SELECT id, country_name, nationality FROM countries_nationality');
  const nationalityByName = new Map<string, number>();
  for (const n of nationalityRows) {
    if (n.nationality) nationalityByName.set(String(n.nationality).trim().toLowerCase(), n.id);
    if (n.country_name) nationalityByName.set(String(n.country_name).trim().toLowerCase(), n.id);
  }

  // Duplicate sources: active employees (same six numbers the Join form checks) and joins still
  // pending onboarding (Aadhaar / PAN, as legacy checks emp_join). Rows accepted earlier in this
  // same file are added as they go, so a file can't contain the same person twice.
  const [activeRows] = await pool.execute<RowDataPacket[]>(
    'SELECT id_card, pan_no, esi, company_pf, lwf_code, account_no FROM emp_details WHERE status = 1'
  );
  const [pendingRows] = await pool.execute<RowDataPacket[]>('SELECT id_card, pan_no FROM emp_join WHERE status = 1');
  const taken: Record<'id_card' | 'pan_no' | 'esi' | 'company_pf' | 'lwf_code' | 'account_no', Set<string>> = {
    id_card: new Set(), pan_no: new Set(), esi: new Set(), company_pf: new Set(), lwf_code: new Set(), account_no: new Set(),
  };
  for (const r of [...activeRows, ...pendingRows]) {
    for (const k of Object.keys(taken) as (keyof typeof taken)[]) {
      const v = r[k] == null ? '' : String(r[k]).trim().toUpperCase();
      if (v) taken[k].add(v);
    }
  }
  const DUP_LABEL: Record<keyof typeof taken, string> = {
    id_card: 'Aadhaar No', pan_no: 'PAN No', esi: 'ESI No', company_pf: 'UAN No', lwf_code: 'LWF Registration No', account_no: 'Account Number',
  };

  const errors: { row: number; message: string }[] = [];
  let inserted = 0;
  let duplicates = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // header is line 1
    const cell = (h: string) => str(row[h]);

    // Blank line in the sheet (legacy skips these silently).
    if (!cell('Name *') && !cell('Aadhaar No *')) continue;

    const missing = ['Name *', 'Birth Date * (yyyy-mm-dd)', 'Gender *', 'Nationality *', 'Aadhaar No *']
      .filter((h) => !cell(h)).map((h) => h.replace(' *', '').replace(' (yyyy-mm-dd)', ''));
    if (missing.length) {
      errors.push({ row: rowNum, message: `Mandatory field${missing.length > 1 ? 's' : ''} missing: ${missing.join(', ')}` });
      continue;
    }

    const rawDob = row['Birth Date * (yyyy-mm-dd)'];
    const birthDate = parseDate(typeof rawDob === 'number' ? rawDob : cell('Birth Date * (yyyy-mm-dd)'));
    if (!birthDate) {
      errors.push({ row: rowNum, message: `Invalid Birth Date "${cell('Birth Date * (yyyy-mm-dd)')}" — use yyyy-mm-dd or dd/mm/yyyy` });
      continue;
    }

    const gender = normalizeGender(cell('Gender *'));
    if (!gender) { errors.push({ row: rowNum, message: `Invalid Gender "${cell('Gender *')}" — use Male, Female or Other` }); continue; }

    const nationalityId = nationalityByName.get(cell('Nationality *').toLowerCase());
    if (!nationalityId) { errors.push({ row: rowNum, message: `Unrecognized Nationality "${cell('Nationality *')}"` }); continue; }

    const name = titleCase(cell('Name *').replace(/\s+/g, ' '));
    // Legacy bulk upload's own Name rule: letters, digits, spaces, "." and "-".
    if (/[^A-Za-z0-9.\s-]/.test(name)) {
      errors.push({ row: rowNum, message: 'Name can only contain letters, numbers, spaces, "." and "-"' });
      continue;
    }

    const blood = cell('Blood Group').toUpperCase().replace(/\s+/g, '');
    if (blood && !VALID_BLOOD_GROUPS.includes(blood)) {
      errors.push({ row: rowNum, message: `Invalid Blood Group "${cell('Blood Group')}" — use one of ${VALID_BLOOD_GROUPS.join(', ')}` });
      continue;
    }

    const maritalRaw = titleCase(cell('Marital Status'));
    if (maritalRaw && !MARITAL.includes(maritalRaw)) {
      errors.push({ row: rowNum, message: `Invalid Marital Status "${cell('Marital Status')}" — use ${MARITAL.join(', ')}` });
      continue;
    }

    const internationalWorker = yn(row['International Worker (Yes/No)']);
    const countryName = cell('Country of Origin');
    const countryOriginId = internationalWorker === 'Y' && countryName ? nationalityByName.get(countryName.toLowerCase()) : null;
    if (internationalWorker === 'Y' && countryName && !countryOriginId) {
      errors.push({ row: rowNum, message: `Unrecognized Country of Origin "${countryName}"` });
      continue;
    }

    const locomotive = yn(row['Locomotive (Yes/No)']);
    const hearing = yn(row['Hearing (Yes/No)']);
    const visual = yn(row['Visual (Yes/No)']);
    // A disability type implies Physical Handicap (the form only shows the three types under it).
    const physicalHandicap = locomotive === 'Y' || hearing === 'Y' || visual === 'Y' ? 'Y' : yn(row['Physical Handicap (Yes/No)']);

    const v: Record<string, string> = {
      // Whole name in first_name, last_name left empty — as legacy stores it (single Name field).
      first_name: name,
      email: cell('Email Address').toLowerCase(),
      mobile_no: cell('Phone Number').replace(/[\s-]/g, ''),
      address: cell('Address'),
      pincode: cell('Pin Code'),
      state: titleCase(cell('State')),
      district: titleCase(cell('District')),
      guradian: titleCase(cell('Guardian Name')),
      relation_guardian: titleCase(cell('Relation')),
      id_card: cell('Aadhaar No *').replace(/\s+/g, ''),
      pan_no: cell('PAN No').toUpperCase(),
      bank: titleCase(cell('Bank Name')),
      bank_branch: titleCase(cell('Branch')),
      ifsc_code: cell('IFSC Code').toUpperCase(),
      account_no: cell('Account Number').replace(/\s+/g, ''),
      esi: cell('ESI No'),
      esi_dispensary: cell('ESI Dispensary'),
      pf: cell('PF No'),
      company_pf: cell('UAN No'),
      previous_member_id: cell('Previous Member ID'),
      wps_code: cell('WPS ID'),
      lwf_code: cell('LWF Registration No').toUpperCase(),
    };

    const formatError =
      dobError(birthDate) ||
      (v.email ? emailError(v.email) : null) ||
      mobileError(v.mobile_no) ||
      statutoryFieldErrors(v, { aadhaarRequired: true });
    if (formatError) { errors.push({ row: rowNum, message: formatError }); continue; }

    const tooLong = Object.entries(v).find(([k, val]) => EMPLOYEE_FIELD_LIMITS[k] && val.length > EMPLOYEE_FIELD_LIMITS[k]);
    if (tooLong) {
      const [k] = tooLong;
      const LABELS: Record<string, string> = {
        first_name: 'Name', email: 'Email Address',
        address: 'Address', state: 'State', district: 'District', guradian: 'Guardian Name', relation_guardian: 'Relation',
        bank: 'Bank Name', bank_branch: 'Branch', ifsc_code: 'IFSC Code', esi_dispensary: 'ESI Dispensary',
        previous_member_id: 'Previous Member ID', wps_code: 'WPS ID',
      };
      const label = LABELS[k] ?? k.replace(/_/g, ' ');
      errors.push({ row: rowNum, message: `${label} is longer than ${EMPLOYEE_FIELD_LIMITS[k]} characters` });
      continue;
    }

    const dupFields = (Object.keys(taken) as (keyof typeof taken)[]).filter((k) => v[k] && taken[k].has(v[k].toUpperCase()));
    if (dupFields.length) {
      duplicates++;
      errors.push({ row: rowNum, message: `Duplicate ${dupFields.map((k) => DUP_LABEL[k]).join(' and ')} — already used by an existing employee, a pending join, or an earlier row` });
      continue;
    }

    try {
      await pool.execute(
        `INSERT INTO emp_join
           (emp_fkey, status, first_name, last_name, date_of_birth, classification, email, mobile_no,
            address, pincode, nationality_id, state, district, maritual_status, guradian, relation_guardian,
            blood, id_card, pan_no, bank, bank_branch, ifsc_code, account_no, esi, esi_dispensary, pf,
            company_pf, previous_member_id, wps_code, lwf_code, eps, physical_handicap,
            international_worker, country_origin, locomotive, hearing, visual)
         VALUES (0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          v.first_name, null, birthDate, gender, v.email || null, v.mobile_no || null,
          v.address || null, v.pincode || null, nationalityId, v.state || null, v.district || null,
          maritalRaw || null, v.guradian || null, v.relation_guardian || null, blood || null,
          v.id_card, v.pan_no || null, v.bank || null, v.bank_branch || null, v.ifsc_code || null, v.account_no || null,
          v.esi || null, v.esi_dispensary || null, v.pf || null, v.company_pf || null,
          v.previous_member_id || null, v.wps_code || null, v.lwf_code || null,
          yn(row['EPS Eligibility (Yes/No)']), physicalHandicap, internationalWorker, countryOriginId ?? null,
          locomotive, hearing, visual,
        ]
      );
    } catch (err) {
      errors.push({ row: rowNum, message: `Could not save this row (${err instanceof Error ? err.message : 'database error'})` });
      continue;
    }
    inserted++;
    for (const k of Object.keys(taken) as (keyof typeof taken)[]) if (v[k]) taken[k].add(v[k].toUpperCase());
  }

  return NextResponse.json({ success: true, inserted, duplicates, errors });
}
