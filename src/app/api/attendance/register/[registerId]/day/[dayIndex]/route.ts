import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getRegisterDayContext, isLeaveAlreadyApplied, mergeHalfDayStatus, recalcAttendanceRegisterTotals, toISODate } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';

// Ports chnagestatus() (parameterized — legacy's version had a real SQL-injection surface via raw
// string concatenation). statusType: 'first' | 'second' | 'full' -> leave session 1 | 2 | 3.
// Per explicit product decision, a leave-code status picked here is UI/FIELDn-display only — no
// leaveentries/emp_leave_transactions row is created at Save time. The actual leave application
// only happens when the register row is verified (see /verify/route.ts), matching "leave codes
// aren't real leave entries until verification, just a cell value until then."
// The half-day merge (see mergeHalfDayStatus) is legacy's own client-side JS logic, done here
// server-side instead: `status` is just the raw code the caller picked for this one half (e.g. 'P'),
// not a pre-combined "X/Y" string — the FIELDn column always stores both halves together.

const SESSION_BY_TYPE: Record<string, 1 | 2 | 3> = { first: 1, second: 2, full: 3 };

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ registerId: string; dayIndex: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { registerId, dayIndex } = await params;
  const dayIdx = Number(dayIndex);
  if (!Number.isInteger(dayIdx) || dayIdx < 1 || dayIdx > 32) {
    return NextResponse.json({ error: 'dayIndex must be between 1 and 32' }, { status: 400 });
  }

  const body = await request.json();
  const { status, statusType, salaryHeadItemFkey } = body as {
    status: string;
    statusType: 'first' | 'second' | 'full';
    salaryHeadItemFkey?: number;
  };
  const leaveSession = SESSION_BY_TYPE[statusType];
  if (!status || !leaveSession) {
    return NextResponse.json({ error: 'status and a valid statusType are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const fieldCol = `FIELD${dayIdx}`;

  const day = await getRegisterDayContext(pool, registerId, dayIdx);
  if (!day) return NextResponse.json({ error: 'Register row not found' }, { status: 404 });
  if (day.locked) {
    return NextResponse.json({ error: 'This month is verified/locked and cannot be edited' }, { status: 409 });
  }

  const attDate = day.attDate;

  const alreadyApplied = await isLeaveAlreadyApplied(pool, day.empFkey, attDate, leaveSession);
  if (alreadyApplied) {
    return NextResponse.json(
      { error: 'A leave has already been applied for this date/session — change it via the Leave module instead' },
      { status: 409 }
    );
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // A day cell always stores both halves ("X/Y") — merge this edit's half into whatever the other
    // half currently holds instead of overwriting the whole cell (see mergeHalfDayStatus).
    const mergedStatus = mergeHalfDayStatus(day.currentStatus, statusType, status);

    await connection.execute(
      `UPDATE attendance_register SET ${fieldCol} = ? WHERE registerid = ?`,
      [mergedStatus, registerId]
    );

    // Mirrors legacy's chnagestatus(): every day-cell edit recomputes and persists the register's
    // totals from the (now-updated) FIELD1..32 codes — see recalcAttendanceRegisterTotals.
    await recalcAttendanceRegisterTotals(connection, Number(registerId));

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  return NextResponse.json({ success: true, attDate: toISODate(attDate) });
}
