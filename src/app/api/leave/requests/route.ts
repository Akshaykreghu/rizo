import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { attendancePunchConflictMessage, checkAttendancePunches, checkAttendanceRegisterRangeVerified, checkExistingLeaveOverlap, describeLeaveTransactionFailure, getEmployeeLeaveTypes, isLeaveTransactionFailure, runLeaveTransaction, toISODate } from '@/lib/leave';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Ports LeaveRequestController's core list + saveLeaveEntry() (apply path only — edit/cancel are
// separate routes). Employee self-service (userGroup !== 1) is scoped to their own emp_fkey on
// GET/POST, same precedent as attendance/regularisation and leave/encashment — plus an
// approver-queue mode (?authorizerFkey= / ?approverFkey=), always forced to the caller's own
// empFkey for non-admins, backing the ESS Approvals page.

// Day-count for a FROMDATE/TOHALF range: inclusive calendar days minus 0.5 for each half-day end.
// NOTE: unlike insert_update_att_reg (attendance), this raw count does not exclude weekoffs/holidays —
// legacy's own day-count computation for the apply form is client-side JS not fully re-derived from
// source; flagged here as a simplification to revisit if real usage shows a mismatch against legacy.
function calcLeaveDays(fromDate: string, fromHalf: number, toDate: string, toHalf: number): number {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  let total = days;
  if (fromHalf === 2) total -= 0.5;
  if (toHalf === 1) total -= 0.5;
  // Math.max(NaN, 0.5) is NaN, not 0.5 — an invalid/unparseable date pair silently produced a
  // leave_days=0 row on insert (MySQL coerces NaN to 0) instead of being caught here. The route
  // now validates both dates parse before this is ever called, so this is a defensive backstop.
  if (Number.isNaN(total)) return 0.5;
  return Math.max(total, 0.5);
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? '';
  const isAdmin = session.user.userGroup === 1;
  const pool = await getCompanyPool(session.user.companyCode);

  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (isAdmin) {
    const employee = searchParams.get('employee') ?? '';
    const authorizerFkey = searchParams.get('authorizerFkey') ?? '';
    const approverFkey = searchParams.get('approverFkey') ?? '';
    if (employee) { conditions.push('le.EMP_fkey = ?'); values.push(Number(employee)); }
    if (authorizerFkey) { conditions.push('le.ISAutherizedby = ?'); values.push(Number(authorizerFkey)); }
    if (approverFkey) { conditions.push('le.APPROVEDBY = ?'); values.push(Number(approverFkey)); }
  } else if (searchParams.get('authorizerFkey') || searchParams.get('approverFkey')) {
    // Approver queue: always the caller's own empFkey, never an arbitrary id from the query string.
    conditions.push('(le.ISAutherizedby = ? OR le.APPROVEDBY = ?)');
    values.push(session.user.empFkey!, session.user.empFkey!);
  } else {
    // Own leave history — regardless of what's in the query string.
    conditions.push('le.EMP_fkey = ?');
    values.push(session.user.empFkey!);
  }
  if (status) { conditions.push('le.LEAVESTATUS = ?'); values.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // isAttendanceVerified: whether attendance_register already has a verified (isdelete='N') row
  // for this employee's FROMDATE month — the same signal checkAttendanceRegisterRangeVerified
  // uses to block approve/cancel, surfaced here as a per-row indicator instead of N separate
  // per-row lookups.
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT le.LEAVEENTRYID, le.EMP_fkey, le.salary_head_item_fkey, shi.item AS leave_type,
            le.FROMDATE, le.FROMHALF, le.TODATE, le.TOHALF, le.leave_days, le.LEAVESTATUS,
            le.ISAutherizedby, le.ISAutherized, le.Autherized_date, le.APPROVEDBY, le.ISAPPROVED, le.APPROVED_date,
            le.Reason, le.contact_No, le.contact_person, le.REMARKS, le.applied_date, le.file_name, le.file_type,
            ed.first_name, ed.last_name, ed.emp_id,
            auth.first_name AS authorized_by_first_name, auth.last_name AS authorized_by_last_name,
            appr.first_name AS approved_by_first_name, appr.last_name AS approved_by_last_name,
            EXISTS(
              SELECT 1 FROM attendance_register ar
              WHERE ar.emp_fkey = le.EMP_fkey AND ar.isdelete = 'N'
                AND ar.month_year = DATE_FORMAT(le.FROMDATE, '%Y-%m')
            ) AS isAttendanceVerified
     FROM leaveentries le
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = le.salary_head_item_fkey
     JOIN emp_details ed ON ed.emp_pkey = le.EMP_fkey
     LEFT JOIN emp_details auth ON auth.emp_pkey = le.ISAutherizedby
     LEFT JOIN emp_details appr ON appr.emp_pkey = le.APPROVEDBY
     ${where}
     ORDER BY le.LEAVEENTRYID DESC
     LIMIT 200`,
    values
  );

  // mysql2 returns DATE columns as JS Date objects, which JSON.stringify serializes with a
  // T00:00:00.000Z time/timezone component — these are date-only fields, so strip that down to
  // a plain YYYY-MM-DD string before it reaches the client.
  const data = rows.map((r) => ({
    ...r,
    FROMDATE: toISODate(r.FROMDATE),
    TODATE: toISODate(r.TODATE),
    applied_date: r.applied_date != null ? toISODate(r.applied_date) : null,
    isAttendanceVerified: Boolean(r.isAttendanceVerified),
  }));

  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    salaryHeadItemFkey, fromDate, fromHalf, toDate, toHalf,
    reason, contactNo, contactPerson, authorizerFkey, approverFkey, fileName, fileType,
  } = body as {
    empFkey?: number; salaryHeadItemFkey: number; fromDate: string; fromHalf: number;
    toDate: string; toHalf: number; reason?: string; contactNo?: string; contactPerson?: string;
    authorizerFkey?: number; approverFkey?: number; fileName?: string; fileType?: string;
  };
  // Employee self-service can only ever apply for themselves — the emp_fkey comes from the
  // session, not the request body, regardless of what a tampered payload sends.
  const empFkey = session.user.userGroup === 1 ? body.empFkey : session.user.empFkey;

  if (!empFkey || !salaryHeadItemFkey || !fromDate || !toDate || !fromHalf || !toHalf) {
    return NextResponse.json(
      { error: 'empFkey, salaryHeadItemFkey, fromDate, fromHalf, toDate and toHalf are required' },
      { status: 400 }
    );
  }
  if (toDate < fromDate) {
    return NextResponse.json({ error: 'toDate cannot be before fromDate' }, { status: 400 });
  }
  if (Number.isNaN(new Date(fromDate).getTime()) || Number.isNaN(new Date(toDate).getTime())) {
    return NextResponse.json({ error: 'fromDate and toDate must be valid dates' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const types = await getEmployeeLeaveTypes(pool, empFkey);
  const type = types.find((t) => t.salaryHeadItemFkey === Number(salaryHeadItemFkey));
  if (!type) {
    return NextResponse.json({ error: 'This leave type is not part of the employee\'s leave policy' }, { status: 400 });
  }

  // Ported from saveLeaveEntry()'s own existing-leave overlap guard (controller.php:1994-2029) —
  // a distinct check from the attendance-verified/punch checks below, scoped to the employee's OWN
  // prior leave requests rather than real attendance.
  const overlap = await checkExistingLeaveOverlap(pool, empFkey, fromDate, toDate, Number(fromHalf), Number(toHalf));
  if (overlap) return NextResponse.json({ error: overlap }, { status: 409 });

  // Ported from saveLeaveEntry()'s boundary-spanning attendance-verified check (controller.php:
  // 1716-1757) — the same 4-branch att_start_end_fn-anchored logic already correctly used by the
  // bulk-upload single-add path; this route previously called a cruder single-month lookup
  // (checkAttendanceConflict, now removed) that missed the case where FROMDATE falls near a
  // verification-period boundary and the FOLLOWING month is the one actually verified.
  const attendanceVerifiedConflict = await checkAttendanceRegisterRangeVerified(pool, empFkey, fromDate, toDate);
  if (attendanceVerifiedConflict) return NextResponse.json({ error: attendanceVerifiedConflict }, { status: 409 });

  // Final server-side guard from saveLeaveEntry() (controller.php:1691-1709, added 2026-05-20) —
  // half-day-aware punch conflict, checked separately from the attendance-verified check above since
  // legacy treats these as two distinct checks on this exact save path.
  const conflictMask = await checkAttendancePunches(pool, empFkey, fromDate, toDate, Number(fromHalf), Number(toHalf));
  if (conflictMask) {
    return NextResponse.json({ error: attendancePunchConflictMessage(conflictMask, 'save') }, { status: 409 });
  }

  // Ported from GetLeaveBalanceNew's document_mandatory flag (leavepolicy.document_mandatory) —
  // addeditleave_new.ctp only enforces this client-side (disables submit / marks the file input
  // required); re-checked here server-side since a client-only check can't be trusted.
  const [[docPolicy]] = await pool.execute<RowDataPacket[]>(
    `SELECT document_mandatory FROM leavepolicy
     WHERE salary_head_item_fkey = ? AND status = 1
       AND LEAVEPOLICY_GROUP_ID IN (SELECT LEAVEPOLICY_GROUP_ID FROM emp_proff WHERE emp_fkey = ?)`,
    [salaryHeadItemFkey, empFkey]
  );
  if (docPolicy?.document_mandatory === 'Y' && !fileName) {
    return NextResponse.json({ error: 'A supporting document is required for this leave type' }, { status: 400 });
  }

  // ISAutherizedby is NOT NULL with no default (same gotcha Phase 3 hit for attendance-side leave
  // writes) — fall back to 0 for an admin-only session with no employee record, matching that precedent.
  const isAutherizedby = authorizerFkey ?? session.user.empFkey ?? 0;
  const approvedBy = approverFkey ?? null;
  const leaveDays = calcLeaveDays(fromDate, Number(fromHalf), toDate, Number(toHalf));

  // Admin applying leave on an employee's behalf skips the Applied/Authorized queue entirely —
  // it lands already Approved, same end state the authorize/approve routes reach for a normal
  // employee-initiated request, just without the extra clicks.
  const isAdmin = session.user.userGroup === 1;

  // Row is always first inserted as 'Applied' — matching EmployeeLeaveUploadController::leavesave(),
  // which writes LEAVESTATUS='Applied' even when APPROVED_date/ApproveRemarks are populated in the
  // same insert for an auto-approved (admin-applied) leave. The Authorized/Approved-looking columns
  // land in this same row; only LEAVESTATUS itself stays 'Applied' until the proc is called again.
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO leaveentries
       (salary_head_item_fkey, applied_date, LEAVESTATUS, EMP_fkey, FROMDATE, FROMHALF, TODATE, TOHALF,
        ISAutherizedby, APPROVEDBY, ISAutherized, Autherized_date, ISAPPROVED, APPROVED_date,
        Reason, contact_No, contact_person, leave_days, file_name, file_type)
     VALUES (?, CURDATE(), 'Applied', ?, ?, ?, ?, ?, ?, ?, ?, ${isAdmin ? 'CURDATE()' : 'NULL'}, ?, ${isAdmin ? 'CURDATE()' : 'NULL'}, ?, ?, ?, ?, ?, ?)`,
    [
      salaryHeadItemFkey, empFkey, fromDate, fromHalf, toDate, toHalf,
      isAutherizedby, approvedBy,
      isAdmin ? 1 : 0, isAdmin ? 1 : 0,
      reason ?? null, contactNo ?? null, contactPerson ?? null, leaveDays,
      fileName ?? null, fileType ?? null,
    ]
  );
  const leaveEntryId = result.insertId;

  // First proc call: status 'Applied' — this is what actually creates the emp_leave_transactions
  // row(s) for this leave (confirmed via EmployeeLeaveUploadController::leavesave()'s two-call
  // sequence). Calling the proc directly with 'Approved' and no prior 'Applied' call was the real
  // bug — the proc has nothing to transition, so it silently wrote no transaction row at all.
  const firstCall = await runLeaveTransaction(pool, {
    leaveEntryId, empFkey, fromDate, fromHalf: Number(fromHalf), toDate, toHalf: Number(toHalf),
    leaveDays, status: 'Applied',
  });
  let finalStatus = firstCall.finalStatus;
  const leaveMessage = firstCall.leaveMessage;

  // Ported from saveLeaveEntry()'s `if (!$out)` branch (controller.php:2139-2150): when the proc
  // rejects (e.g. finalStatus 'Can not Apply 0 days', typically a range that falls entirely on
  // week-off/holiday days), legacy does NOT roll back or fail the request — the leaveentries row
  // stays exactly as the proc left it, and the response just carries a warningmessage (read from
  // leaveentries.message, the proc's own specific reason — e.g. naming the weekoff/holiday date —
  // not the generic status text) alongside the otherwise-normal success payload.
  const warningMessage = isLeaveTransactionFailure(finalStatus) ? describeLeaveTransactionFailure(finalStatus, leaveMessage) : null;

  // Second proc call, admin-applied leave only: status 'Approved' — transitions the transaction(s)
  // just created above from Applied to Approved, matching legacy's re-fetch-then-call-again pattern.
  if (isAdmin && finalStatus === 'Applied') {
    ({ finalStatus } = await runLeaveTransaction(pool, {
      leaveEntryId, empFkey, fromDate, fromHalf: Number(fromHalf), toDate, toHalf: Number(toHalf),
      leaveDays, status: 'Approved',
    }));
  }

  return NextResponse.json({
    success: true, id: leaveEntryId, leaveDays, status: finalStatus, warningMessage,
  });
}
