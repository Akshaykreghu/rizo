import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { checkAttendanceConflict, runLeaveTransaction } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import * as XLSX from 'xlsx';

// Ports EmployeeLeaveUploadController::uploadandsaveempctc() — confirmed live via emp_menu
// (menu_id 39 "Leave Upload" -> EmployeeLeaveUpload, active). The sibling EmpleaveuploadController
// is unrouted/dead, not ported.
//
// Real, deliberate legacy behavior carried forward: unlike the single Apply-leave form (which starts
// at 'Applied' and needs a separate authorize/approve), a bulk-uploaded row is auto-approved in the
// same request — legacy sets LEAVESTATUS straight to 'Approved' with REMARKS 'Leave approved from
// Leave Upload excel'. This isn't a shortcut we invented; it's legacy's own explicit final step.
//
// Legacy's monthly-balance gate (getLeaveBalanceForAuthOrApproval) is NOT ported: verified against
// source it's dead code for every company except a hardcoded 11-tenant list (GRTL not among them) —
// for everyone else monthly_balance is hardcoded to 0 and leave_days is read from a key ('l_day')
// the function never actually returns (real key is 'l_days'), so the check `0 - 0 < 0` never fires.
// Same "commented-out enforcement, matched not invented" precedent as the single-apply path's
// balance-insufficiency check.
//
// leaveentries.emp_leave_upload_fkey referenced in legacy source does not exist in the live schema
// (confirmed via DESCRIBE) — CakePHP silently drops it; only the reverse link
// (emp_leave_upload.leaveentry_id, a real column) is used here.

function str(value: unknown): string {
  return String(value ?? '').trim();
}

function excelDateToISO(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value);
    if (!date) return null;
    return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
  }
  const s = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

function calcLeaveDays(fromDate: string, fromHalf: number, toDate: string, toHalf: number): number {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  let total = days;
  if (fromHalf === 2) total -= 0.5;
  if (toHalf === 1) total -= 0.5;
  return Math.max(total, 0.5);
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
  const approverFkey = session.user.empFkey ?? 0;

  const [[pidRow]] = await pool.execute<RowDataPacket[]>(
    'SELECT COALESCE(MAX(PID), 0) + 1 AS pid FROM emp_leave_upload'
  );
  const batchPid = pidRow?.pid ?? 1;

  const errors: { row: number; message: string }[] = [];
  let imported = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const userId = str(row['Employee ID *']);
    const empName = str(row['Employee Name *']);
    const leaveTypeCode = str(row['Leave Type (code) *']);
    if (!userId || !empName || !leaveTypeCode) continue; // matches legacy: silently skips blank mandatory fields

    const fromDate = excelDateToISO(row['Leave Start Date * (yyyy-mm-dd)']);
    const toDate = excelDateToISO(row['Leave End Date * (yyyy-mm-dd)']);
    const fromHalf = Number(row['Leave Start Session * (1=Full/Morning, 2=Afternoon)']) || 1;
    const toHalf = Number(row['Leave End Session * (1=Morning, 2=Full/Afternoon)']) || 2;
    const reason = str(row['Reason']) || null;

    if (!fromDate || !toDate) {
      errors.push({ row: rowNum, message: 'Leave Start Date and Leave End Date are required' });
      continue;
    }
    if (fromDate > toDate) {
      errors.push({ row: rowNum, message: 'Leave Start Date cannot be after Leave End Date' });
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

    const [[leaveType]] = await pool.execute<RowDataPacket[]>(
      `SELECT salary_head_item_pkey FROM salary_head_items
       WHERE head_fkey = 6 AND value = 'Y' AND status = 1 AND occurance = ? AND item_part = 'Direct'`,
      [leaveTypeCode]
    );
    if (!leaveType) {
      errors.push({ row: rowNum, message: `Unrecognized leave type code "${leaveTypeCode}"` });
      continue;
    }
    const salaryHeadItemFkey = leaveType.salary_head_item_pkey as number;

    const conflict = await checkAttendanceConflict(pool, empFkey, fromDate, toDate);
    if (conflict) {
      errors.push({ row: rowNum, message: conflict });
      continue;
    }

    const [[overlap]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM leaveentries
       WHERE EMP_fkey = ? AND LEAVESTATUS IN ('Applied', 'Authorized', 'Approved')
         AND FROMDATE <= ? AND TODATE >= ?`,
      [empFkey, toDate, fromDate]
    );
    if (Number(overlap?.cnt ?? 0) > 0) {
      errors.push({ row: rowNum, message: 'An active leave already exists overlapping these dates' });
      continue;
    }

    const leaveDays = calcLeaveDays(fromDate, fromHalf, toDate, toHalf);

    const [uploadResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO emp_leave_upload
         (PID, emp_fkey, leave_type, leave_start_date, leave_start_session, leave_end_date, leave_end_session,
          created_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [batchPid, empFkey, salaryHeadItemFkey, fromDate, fromHalf, toDate, toHalf, session.user.loginUserId]
    );
    const uploadId = uploadResult.insertId;

    const [entryResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO leaveentries
         (salary_head_item_fkey, applied_date, LEAVESTATUS, EMP_fkey, FROMDATE, FROMHALF, TODATE, TOHALF,
          ISAutherizedby, APPROVEDBY, Reason, leave_days)
       VALUES (?, CURDATE(), 'Applied', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [salaryHeadItemFkey, empFkey, fromDate, fromHalf, toDate, toHalf, approverFkey, approverFkey, reason, leaveDays]
    );
    const leaveEntryId = entryResult.insertId;

    await pool.execute('UPDATE emp_leave_upload SET leaveentry_id = ? WHERE emp_leave_upload_pkey = ?', [leaveEntryId, uploadId]);

    // Must call the proc with 'Applied' first — confirmed live that leave_transaction_prc only
    // INSERTs an emp_leave_transactions row on an 'Applied' call; calling it directly with
    // 'Approved' silently creates no transaction row and no error. This is exactly why legacy's own
    // uploadandsaveempctc() does the same two-step (call with 'Applied', then separately flip both
    // leaveentries and the just-created emp_leave_transactions row to 'Approved') rather than a
    // single direct-to-Approved call — not legacy redundancy, a real proc constraint.
    await runLeaveTransaction(pool, {
      leaveEntryId, empFkey, fromDate, fromHalf, toDate, toHalf, leaveDays, status: 'Applied',
    });

    // Legacy's real final step: auto-approve immediately, same request (not a two-step
    // apply-then-approve like the interactive form) — matches uploadandsaveempctc()'s explicit
    // "Leave approved from Leave Upload excel" remarks, including flipping the transaction row
    // legacy's own code updates directly (lines ~1737-1750) rather than through another proc call.
    await pool.execute(
      `UPDATE leaveentries
       SET LEAVESTATUS = 'Approved', ISAutherized = 1, ISAPPROVED = 1,
           ISAutherizedby = ?, APPROVEDBY = ?, Autherized_date = CURDATE(), APPROVED_date = CURDATE(),
           REMARKS = 'Leave approved from Leave Upload excel',
           AuthoriseRemarks = 'Leave authorised from Leave Upload excel',
           ApproveRemarks = 'Leave approved from Leave Upload excel'
       WHERE LEAVEENTRYID = ?`,
      [approverFkey, approverFkey, leaveEntryId]
    );
    await pool.execute(
      `UPDATE emp_leave_transactions SET Leavestatus = 'Approved'
       WHERE LEAVEENTRYID = ? AND Leavestatus = 'Applied'`,
      [leaveEntryId]
    );

    imported++;
  }

  return NextResponse.json({ success: true, imported, errors });
}
