import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// mysql2 returns DATE columns as JS Date objects (no dateStrings config on the pool) — String(date)
// gives a locale toString(), not ISO, which silently corrupted date comparisons here previously.
function toISODate(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

// Mirrors legacy EmployeeResignationController::setup()'s validation gates (the ones that
// actually die() before rendering the "Process Full & Final" screen). ABSG's site_attendance_register
// branch is out of scope (GRTL-only tenant). The two attendance-window checks (4a/4b below) are
// ported with the same SQL shape legacy uses, but since emp_detail_timeattandance is completely
// empty until the Attendance phase exists, they resolve to "nothing to check yet" rather than a
// hard block — this is the honest behavior of running legacy's own logic against empty tables,
// not a deliberate softening of the gate.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  const blockers: string[] = [];

  const [[term]] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_fkey, submitted_date, last_approved_working_date, notice_period
     FROM termination WHERE Resignation_pkey = ? AND status = 1`,
    [id]
  );
  if (!term) {
    // Pre-existing resignation_requests rows created before this app's POST /api/resignations
    // (which always creates both rows together) can lack a companion termination row entirely.
    // Report this as a clear blocker rather than a bare 404 the settlement UI can't render.
    return NextResponse.json({
      ok: false,
      blockers: ['No termination record exists for this resignation. Use Edit to re-save it and create one, then try again.'],
    });
  }

  const empFkey = term.emp_fkey;
  const submittedDate = toISODate(term.submitted_date);
  const lastApprovedWd = toISODate(term.last_approved_working_date);
  const today = new Date().toISOString().slice(0, 10);

  // 1. last_approved_working_date must not be in the future.
  if (lastApprovedWd > today) {
    blockers.push(`You cannot process the full and final before ${lastApprovedWd}`);
  }

  // 2. Not already processed (emp_settle_slip joined to a status=2/Terminated employee).
  const [[already]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM emp_settle_slip s
     JOIN emp_details e ON e.emp_pkey = s.emp_fkey
     WHERE s.emp_fkey = ? AND e.status = 2`,
    [empFkey]
  );
  if (Number(already.cnt) > 0) {
    blockers.push('Termination already processed');
  }

  // 3. Shift and salary structure must both be assigned.
  const [[proff]] = await pool.execute<RowDataPacket[]>(
    `SELECT day_time_seq, structure_id FROM emp_proff WHERE emp_fkey = ?`,
    [empFkey]
  );
  if (!proff || !proff.day_time_seq || !proff.structure_id) {
    blockers.push('Please allocate a Shift policy and Salary structure to the employee');
  }

  // 4. Attendance-window checks — only meaningful once emp_detail_timeattandance has real rows.
  const [[range]] = await pool.execute<RowDataPacket[]>(
    `SELECT MIN(yearmonth) AS strt, MAX(yearmonth) AS end_
     FROM emp_detail_timeattandance
     WHERE emp_pkey = ? AND att_date >= ? AND att_date <= ?`,
    [empFkey, submittedDate, lastApprovedWd]
  );

  if (range?.strt && range?.end_) {
    const startMonth = toISODate(range.strt).slice(0, 7);
    const endMonth = toISODate(range.end_).slice(0, 7);

    // 4a. Unprocessed months: legacy compares distinct months across ALL employees against this
    // employee's own months in the window (no emp_fkey filter on the "all" count — a real quirk
    // in the legacy SQL, ported as-is).
    const [[allMonths]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT month_year) AS cnt FROM attendance_register
       WHERE month_year >= ? AND month_year <= ?`,
      [startMonth, endMonth]
    );
    const [empMonths] = await pool.execute<RowDataPacket[]>(
      `SELECT month_year FROM attendance_register
       WHERE emp_fkey = ? AND month_year >= ? AND month_year <= ?`,
      [empFkey, startMonth, endMonth]
    );
    if (Number(allMonths.cnt) > empMonths.length) {
      blockers.push(`Please process the attendance register of this employee (${startMonth} to ${endMonth})`);
    }

    // 4b. Unapproved months (isdelete='Y' means still pending approval in this schema).
    const [unapproved] = await pool.execute<RowDataPacket[]>(
      `SELECT month_year FROM attendance_register
       WHERE emp_fkey = ? AND isdelete = 'Y' AND month_year >= ? AND month_year <= ?`,
      [empFkey, startMonth, endMonth]
    );
    if (unapproved.length > 0) {
      const months = unapproved.map((r) => r.month_year).join(', ');
      blockers.push(`Please approve attendance of this employee (${months})`);
    }
  }

  return NextResponse.json({ ok: blockers.length === 0, blockers });
}
