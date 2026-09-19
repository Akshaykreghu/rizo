import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { checkAttendancePunches, checkAttendanceRegisterRangeVerified, runLeaveTransaction } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports leavesave() (controller.php:231-543) — the manual grid's single-entry add. A different code
// path from the bulk-upload route: different overlap query, different attendance check
// (half-day-aware punches + boundary-spanning verified-month check), and a different (proc-call vs
// direct-UPDATE) approve step for 'Indirect' leave types. Not unified with route.ts's bulk path —
// legacy itself doesn't, and the "full literal parity" decision covers reproducing that, not fixing
// it.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const empFkey = Number(body.empFkey);
  const salaryHeadItemFkey = Number(body.salaryHeadItemFkey);
  const fromDate: string = body.fromDate;
  const fromHalf = Number(body.fromHalf) || 1;
  const toDate: string = body.toDate;
  const toHalf = Number(body.toHalf) || 2;
  const reason: string | null = body.reason || null;
  const contactNo: string | null = body.contactNo || null;
  const contactPerson: string | null = body.contactPerson || null;

  if (!empFkey || !salaryHeadItemFkey || !fromDate || !toDate) {
    return NextResponse.json({ error: 'empFkey, salaryHeadItemFkey, fromDate and toDate are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const approverFkey = session.user.empFkey ?? 0;

  const [[itemRow]] = await pool.execute<RowDataPacket[]>(
    'SELECT item_part FROM salary_head_items WHERE salary_head_item_pkey = ?',
    [salaryHeadItemFkey]
  );
  const itemPart = itemRow?.item_part as string | undefined;

  // Legacy's exact half-day arithmetic (controller.php:267-278) — kept separate from
  // route.ts's calcLeaveDays, which rounds differently for the bulk path.
  const fromMs = new Date(`${fromDate}T00:00:00Z`).getTime();
  const toMs = new Date(`${toDate}T00:00:00Z`).getTime();
  let leaveDays = Math.round((toMs - fromMs) / 86400000) + 1;
  if (fromHalf === 1 && toHalf === 1) leaveDays -= 0.5;
  else if (fromHalf === 2 && toHalf === 2) leaveDays -= 0.5;
  else if (fromHalf === 2 && toHalf === 1) leaveDays -= 1;

  // Overlap check (controller.php:283-284) — a different query from the bulk path's: scoped to
  // emp_leave_transactions/leaveentries with leave_session = 3, not emp_leave_upload.
  const [[overlap]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM emp_leave_transactions elt
     LEFT JOIN leaveentries le ON (le.LEAVEENTRYID = elt.LEAVEENTRYID)
     WHERE le.EMP_fkey = ? AND elt.leave_date BETWEEN ? AND ?
       AND elt.leave_session = 3 AND elt.Leavestatus IN ('Approved', 'Applied', 'Authorized')`,
    [empFkey, fromDate, toDate]
  );
  if (Number(overlap?.cnt ?? 0) > 0) {
    return NextResponse.json(
      { success: false, error: `Leave already existing in the range ${fromDate} - ${toDate}. Please remove it, before applying.` },
      { status: 409 }
    );
  }

  // Punch conflict (controller.php:304-317), half-day-aware.
  const conflictMask = await checkAttendancePunches(pool, empFkey, fromDate, toDate, fromHalf, toHalf);
  if (conflictMask) {
    const msg =
      conflictMask === 1
        ? 'Leave cannot be applied, attendance exists for the first half. Apply leave for next halves'
        : conflictMask === 2
          ? 'Leave cannot be applied, attendance exists for the second half. Apply leave for next halves'
          : 'Leave cannot be applied, attendance exists for full day';
    return NextResponse.json({ success: false, error: msg }, { status: 409 });
  }

  // Boundary-spanning verified-month check (controller.php:320-353).
  const verifiedConflict = await checkAttendanceRegisterRangeVerified(pool, empFkey, fromDate, toDate);
  if (verifiedConflict) {
    return NextResponse.json({ success: false, error: verifiedConflict }, { status: 409 });
  }

  const [uploadResult] = await pool.execute<ResultSetHeader>(
    `INSERT INTO emp_leave_upload
       (PID, emp_fkey, leave_type, leave_start_date, leave_start_session, leave_end_date, leave_end_session,
        created_by, status)
     VALUES (0, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [empFkey, salaryHeadItemFkey, fromDate, fromHalf, toDate, toHalf, session.user.loginUserId]
  );
  const uploadId = uploadResult.insertId;

  // Legacy sets the approval remarks/dates on leaveentries at creation time, before the actual
  // approve step runs (controller.php:421-426) — a real legacy quirk (the row claims "approved"
  // text before the status is flipped), reproduced here rather than deferred to the approve step.
  const [entryResult] = await pool.execute<ResultSetHeader>(
    `INSERT INTO leaveentries
       (salary_head_item_fkey, applied_date, LEAVESTATUS, EMP_fkey, FROMDATE, FROMHALF, TODATE, TOHALF,
        Reason, contact_No, contact_person, leave_days, Autherized_date, REMARKS, APPROVED_date, AuthoriseRemarks, ApproveRemarks)
     VALUES (?, CURDATE(), 'Applied', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, CURDATE(), ?, ?)`,
    [
      salaryHeadItemFkey, empFkey, fromDate, fromHalf, toDate, toHalf, reason, contactNo, contactPerson, leaveDays,
      'Leave approved from Leave Upload', 'Leave authorised from Leave Upload', 'Leave approved from Leave Upload',
    ]
  );
  const leaveEntryId = entryResult.insertId;

  await pool.execute('UPDATE emp_leave_upload SET leaveentry_id = ? WHERE emp_leave_upload_pkey = ?', [leaveEntryId, uploadId]);

  const applied = await runLeaveTransaction(pool, {
    leaveEntryId, empFkey, fromDate, fromHalf, toDate, toHalf, leaveDays, status: 'Applied',
  });

  // Approve step only proceeds if the proc's Applied call didn't itself divert the status
  // elsewhere (matches legacy's `if ($arr_leave_details_old['LEAVESTATUS'] == 'Applied')` guard).
  if (applied.finalStatus === 'Applied') {
    if (itemPart === 'Indirect') {
      // Indirect leave types: direct status flip, no second proc call (controller.php:502-508).
      await pool.execute(
        `UPDATE emp_leave_transactions SET Leavestatus = 'Approved' WHERE LEAVEENTRYID = ?`,
        [leaveEntryId]
      );
      await pool.execute(
        `UPDATE leaveentries SET LEAVESTATUS = 'Approved', leave_days = ? WHERE LEAVEENTRYID = ?`,
        [leaveDays, leaveEntryId]
      );
    } else {
      // All other leave types: second proc call with 'Approved' (controller.php:511-527) — a
      // different approve mechanism from the bulk path's direct UPDATE (route.ts), by design.
      await runLeaveTransaction(pool, {
        leaveEntryId, empFkey, fromDate, fromHalf, toDate, toHalf, leaveDays, status: 'Approved',
      });
    }
    await pool.execute(
      `UPDATE leaveentries SET ISAutherized = 1, ISAPPROVED = 1, ISAutherizedby = ?, APPROVEDBY = ?
       WHERE LEAVEENTRYID = ?`,
      [approverFkey, approverFkey, leaveEntryId]
    );
  }

  return NextResponse.json({ success: true, leaveDays });
}
