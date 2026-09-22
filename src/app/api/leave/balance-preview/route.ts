import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ported from LeaveRequestController::GetLeaveBalanceNew() — called by addeditleave_new.ctp's
// getLeaveBalance() whenever the employee, leave type, or From Date changes on the Apply Leave
// form, so the balance shown reflects the date being applied for (not "today"), before anything
// is saved. Unlike requests/[id]/balance (which reads an existing leaveentries row), this takes
// the in-progress form fields directly since no LEAVEENTRYID exists yet.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const leaveType = searchParams.get('leaveType');
  const fromDate = searchParams.get('fromDate');
  if (!leaveType || !fromDate) {
    return NextResponse.json({ error: 'leaveType and fromDate are required' }, { status: 400 });
  }
  // Self-service can only ever preview their own balance — never an arbitrary employee id from
  // the query string, regardless of what a tampered request sends.
  const isAdmin = session.user.userGroup === 1;
  const employee = isAdmin ? searchParams.get('employee') : String(session.user.empFkey);
  if (!employee) {
    return NextResponse.json({ error: 'employee is required' }, { status: 400 });
  }
  // Employee self-service is scoped to their own emp_fkey, same precedent as every other ESS route.
  if (session.user.userGroup !== 1 && session.user.empFkey !== Number(employee)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const empFkey = Number(employee);
  const salaryHeadItemFkey = Number(leaveType);

  const [[policy]] = await pool.execute<RowDataPacket[]>(
    `SELECT lp.ALLOW_NEGETIVE, lp.exceptions, lp.minimum_service, lp.min_day_before_apply,
            lp.minimum_leave, lp.maximum_leave, lp.leave_policy_type, lp.document_mandatory, lp.REMARKS
     FROM leavepolicy lp
     JOIN emp_proff ep ON ep.LEAVEPOLICY_GROUP_ID = lp.LEAVEPOLICY_GROUP_ID
     WHERE ep.emp_fkey = ? AND lp.salary_head_item_fkey = ? AND lp.status = 1`,
    [empFkey, salaryHeadItemFkey]
  );
  if (!policy) return NextResponse.json({ error: 'No leave policy found for this employee/leave type' }, { status: 404 });

  // GetLeaveBalanceNew always calls leave_balance_inthe_year_fn directly with the applied FROMDATE,
  // regardless of ALLOW_NEGETIVE — unlike getLeaveBalance() (used by the "today" balances grid and
  // the per-entry check), which branches into leave_balance_inthe_month_fn for ALLOW_NEGETIVE='N'
  // policies. That monthly function resolves its window through the fin_year table, which can carry
  // multiple ambiguous "current" rows per branch and return a stale balance. Calling the yearly
  // function directly here matches legacy's actual apply-form behavior and avoids that hazard.
  const [[balRow]] = await pool.query<RowDataPacket[]>(
    'SELECT leave_balance_inthe_year_fn(?, ?, ?) AS bal',
    [empFkey, salaryHeadItemFkey, fromDate]
  );
  const balance = Number(balRow?.bal ?? 0);

  // Minimum-service eligibility check (exceptions='Y' branch of GetLeaveBalanceNew).
  let minServiceOk = true;
  let minServiceMessage: string | null = null;
  if (policy.exceptions === 'Y' && Number(policy.minimum_service) > 0) {
    const [[emp]] = await pool.execute<RowDataPacket[]>(
      'SELECT joining_date FROM emp_proff WHERE emp_fkey = ?',
      [empFkey]
    );
    if (emp?.joining_date) {
      const minDate = new Date(emp.joining_date);
      minDate.setMonth(minDate.getMonth() + Number(policy.minimum_service));
      if (new Date(fromDate) < minDate) {
        minServiceOk = false;
        minServiceMessage = `Employee must complete minimum service of ${policy.minimum_service} month(s) before applying leave. Eligible from ${minDate.toISOString().slice(0, 10)}`;
      }
    }
  }

  // Advance-notice check (same branch).
  let advanceNoticeOk = true;
  let advanceNoticeMessage: string | null = null;
  const minDayBeforeApply = Number(policy.min_day_before_apply ?? 0);
  if (policy.exceptions === 'Y' && minDayBeforeApply > 0) {
    const diffDays = Math.floor((new Date(fromDate).getTime() - Date.now()) / 86400000);
    if (diffDays < minDayBeforeApply) {
      advanceNoticeOk = false;
      advanceNoticeMessage = `Leave should be applied at least ${minDayBeforeApply} day(s) in advance.`;
    }
  }

  return NextResponse.json({
    balance,
    allowNegative: policy.ALLOW_NEGETIVE === 'Y',
    minLeaveLimit: Number(policy.minimum_leave ?? 0),
    maxLeaveLimit: Number(policy.maximum_leave ?? 0),
    minServiceOk,
    minServiceMessage,
    advanceNoticeOk,
    advanceNoticeMessage,
    documentMandatory: policy.document_mandatory === 'Y',
    remarks: policy.REMARKS || null,
  });
}
