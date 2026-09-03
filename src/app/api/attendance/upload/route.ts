import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import * as XLSX from 'xlsx';

// Ports EmployeeAttendanceUploadController — confirmed live (matching model, EmployeeAttendanceUpload.php,
// unlike the model-less EmpattendanceuploadController sibling). Per explicit decision: save straight
// to emp_detailed_attendance_uploads exactly like legacy's attendancesave()/uploadandsaveempctc() do,
// and let the DB's own emp_detailed_attendance_uploads_bi BEFORE INSERT trigger do the rest — it
// dedupes on (emp_fkey, att_time) and inserts the matching device_attandance row itself
// (C3='Uploaded attandance'), so a plain INSERT here is the complete legacy behavior; nothing else
// needs to be replicated in application code.
//
// One deliberate addition beyond legacy: uploadandsaveempctc() itself has NO already-verified guard
// at all (only the single-entry attendancesave() form checks this) — inserting for an already-locked
// month would still fire the trigger and silently write a device_attandance row underneath verified
// attendance. That gap is closed here per-row (skipped with an error, not silently written), matching
// the lock already enforced everywhere else in this app (punches, regularisation, special events).

function str(value: unknown): string {
  return String(value ?? '').trim();
}

const KNOWN_COLUMNS = new Set(['Employee ID *', 'Employee Name', 'Direction * (in/out)']);

function excelCellToDateString(headerKey: string): string | null {
  // Header is always a plain 'YYYY-MM-DD' string, since this project generates its own template.
  return /^\d{4}-\d{2}-\d{2}$/.test(headerKey) ? headerKey : null;
}

function excelTimeToString(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    // Excel time-of-day serial (fraction of a day)
    const totalSeconds = Math.round((value % 1) * 86400);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  const s = String(value).trim();
  return s || null;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  const branch = searchParams.get('branch') ?? '';
  if (!month) return NextResponse.json({ error: 'month is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const conditions = ["au.status = 1", "DATE_FORMAT(au.att_date, '%Y-%m') = ?"];
  const args: (string | number)[] = [month];
  if (branch) {
    conditions.push('ed.branch_code = ?');
    args.push(branch);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT au.emp_detailed_attendance_pkey, au.emp_fkey, au.att_date, au.att_time, au.c1,
            ed.emp_id, ed.first_name, ed.last_name, b.branch_name
     FROM emp_detailed_attendance_uploads au
     JOIN emp_details ed ON ed.emp_pkey = au.emp_fkey
     LEFT JOIN branches b ON b.branch_code = ed.branch_code
     WHERE ${conditions.join(' AND ')}
     ORDER BY au.created_date DESC
     LIMIT 500`,
    args
  );

  return NextResponse.json({ data: rows });
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
  const errors: { row: number; message: string }[] = [];
  let imported = 0;
  const lockedMonthsCache = new Map<string, boolean>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const userId = str(row['Employee ID *']);
    const direction = str(row['Direction * (in/out)']).toLowerCase();
    if (!userId) continue; // matches legacy: silently skips rows with no Employee ID
    if (direction !== 'in' && direction !== 'out') {
      errors.push({ row: rowNum, message: 'Direction must be "in" or "out"' });
      continue;
    }

    const [[user]] = await pool.execute<RowDataPacket[]>(
      'SELECT emp_fkey FROM user_credentials WHERE user_id = ?',
      [userId]
    );
    if (!user?.emp_fkey) {
      errors.push({ row: rowNum, message: `No employee login found for Employee ID "${userId}"` });
      continue;
    }
    const empFkey = user.emp_fkey as number;

    let rowInserted = 0;
    for (const [headerKey, cellValue] of Object.entries(row)) {
      if (KNOWN_COLUMNS.has(headerKey) || headerKey === '') continue;
      const attDate = excelCellToDateString(headerKey);
      if (!attDate) continue;
      const time = excelTimeToString(cellValue);
      if (!time) continue;

      const monthYear = attDate.slice(0, 7);
      let locked = lockedMonthsCache.get(`${empFkey}|${monthYear}`);
      if (locked === undefined) {
        const [[verified]] = await pool.execute<RowDataPacket[]>(
          `SELECT 1 FROM attendance_register WHERE isdelete = 'N' AND emp_fkey = ? AND month_year = ? LIMIT 1`,
          [empFkey, monthYear]
        );
        locked = !!verified;
        lockedMonthsCache.set(`${empFkey}|${monthYear}`, locked);
      }
      if (locked) {
        errors.push({ row: rowNum, message: `${attDate}: attendance already verified for this month, skipped` });
        continue;
      }

      try {
        await pool.execute<ResultSetHeader>(
          `INSERT INTO emp_detailed_attendance_uploads
             (emp_fkey, attendance_type, att_date, att_time, c1, created_by, is_updated, status)
           VALUES (?, 1, ?, ?, ?, ?, '', 1)`,
          [empFkey, attDate, `${attDate} ${time}`, direction, session.user.loginUserId]
        );
        rowInserted++;
      } catch {
        errors.push({ row: rowNum, message: `${attDate}: failed to save` });
      }
    }
    if (rowInserted > 0) imported += rowInserted;
  }

  return NextResponse.json({ success: true, imported, errors });
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { ids } = body as { ids: number[] };
  if (!ids?.length) return NextResponse.json({ error: 'ids is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);

  for (const id of ids) {
    const [[row]] = await pool.execute<RowDataPacket[]>(
      `SELECT au.emp_fkey, au.att_time, au.c1, ed.emp_id
       FROM emp_detailed_attendance_uploads au
       JOIN emp_details ed ON ed.emp_pkey = au.emp_fkey
       WHERE au.emp_detailed_attendance_pkey = ?`,
      [id]
    );
    if (!row) continue;

    await pool.execute(
      `UPDATE emp_detailed_attendance_uploads SET status = 0 WHERE emp_detailed_attendance_pkey = ?`,
      [id]
    );

    // Matches legacy deleteattendance()'s manual cleanup — there's no delete trigger on this table,
    // only the insert one, so the device_attandance row the insert trigger created has to be
    // unwound by hand here, the same way legacy does it.
    await pool.execute(
      `UPDATE device_attandance SET status = 'N'
       WHERE emp_id = ? AND LOGDATE = ? AND C1 = ? AND C3 = 'Uploaded attandance' AND status = 'Y'`,
      [row.emp_id, row.att_time, row.c1]
    );
  }

  return NextResponse.json({ success: true });
}
