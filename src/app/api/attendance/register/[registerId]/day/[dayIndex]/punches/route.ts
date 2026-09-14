import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getRegisterDayContext, isOtEligibleDay } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

// Day-scoped punch add for the register's day-cell modal — same device_attandance/
// device_attandance_hist write as POST /api/attendance/punches, pinned to this cell's date instead
// of a free-form date field, and blocked once the month is verified (matches the day-cell status
// route's lock). After inserting, refreshes emp_ot_timeattandance via ot_duration_register_date if
// this shift is OT-eligible, so the modal's Overtime section reflects the new punch immediately.
//
// PATCH ports EditPunchesController::savepunch()'s inline status-column editor (a checkbox toggling
// status Y/N with a 'Y' -> 'Active' / 'N' -> 'Inactive' device_attandance_hist entry) rather than
// remove()'s hard status='D' delete — deliberately, per product decision: a punch here is deactivated,
// not deleted, so it stays visible (and reversible) instead of disappearing. The live
// device_attandance_au trigger fires on the status UPDATE and recomputes emp_detail_timeattandance's
// duration/present from whichever 'Y' punches remain, exactly like a real delete would, so no manual
// recompute is needed here beyond the same OT refresh the POST does. Unlike legacy's savepunch() (which
// trusts device_attandance_seq alone), this scopes the update to this day's emp_id + SHIFTDATE so one
// day's modal can't be used to toggle an unrelated punch.

export async function POST(
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
  const { logTime, direction } = body as { logTime: string; direction: 'in' | 'out' };
  if (!logTime || !direction) {
    return NextResponse.json({ error: 'logTime and direction are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const day = await getRegisterDayContext(pool, registerId, dayIdx);
  if (!day) return NextResponse.json({ error: 'Register row not found' }, { status: 404 });
  if (day.locked) {
    return NextResponse.json({ error: 'This month is verified/locked and cannot be edited' }, { status: 409 });
  }

  const logDateTime = `${day.attDate} ${logTime}`;
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO device_attandance (company_code, branch_code, emp_id, LOGDATE, SHIFTDATE, C1, C2, status)
     VALUES (?, ?, ?, ?, ?, ?, 'MAN', 'Y')`,
    [day.companyCode, day.branchCode, day.empId, logDateTime, day.attDate, direction]
  );
  await pool.execute(
    `INSERT INTO device_attandance_hist
       (device_attandance_seq, company_code, branch_code, emp_id, LOGDATE, C1, C2, status, created_by, action)
     VALUES (?, ?, ?, ?, ?, ?, 'MAN', 'Y', ?, 'I')`,
    [result.insertId, day.companyCode, day.branchCode, day.empId, logDateTime, direction, session.user.loginUserId]
  );

  if (await isOtEligibleDay(pool, day.empFkey, day.attDate)) {
    await pool.query('SELECT ot_duration_register_date(?, ?, ?)', [day.attDate, day.empFkey, day.branchCode]);
  }

  return NextResponse.json({ success: true, id: result.insertId });
}

export async function PATCH(
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
  const { deviceAttandanceSeq, active } = body as { deviceAttandanceSeq: number; active: boolean };
  if (!deviceAttandanceSeq || typeof active !== 'boolean') {
    return NextResponse.json({ error: 'deviceAttandanceSeq and active are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const day = await getRegisterDayContext(pool, registerId, dayIdx);
  if (!day) return NextResponse.json({ error: 'Register row not found' }, { status: 404 });
  if (day.locked) {
    return NextResponse.json({ error: 'This month is verified/locked and cannot be edited' }, { status: 409 });
  }

  // 'D' (hard-deleted) rows are excluded — this toggles only between 'Y' (active) and 'N' (inactive).
  const [[punch]] = await pool.execute<RowDataPacket[]>(
    `SELECT device_attandance_seq, company_code, branch_code, emp_id, LOGDATE, C1, C2
     FROM device_attandance
     WHERE device_attandance_seq = ? AND emp_id = ? AND SHIFTDATE = ? AND status IN ('Y', 'N')`,
    [deviceAttandanceSeq, day.empId, day.attDate]
  );
  if (!punch) return NextResponse.json({ error: 'Punch not found for this day' }, { status: 404 });

  const newStatus = active ? 'Y' : 'N';
  await pool.execute('UPDATE device_attandance SET status = ? WHERE device_attandance_seq = ?', [newStatus, deviceAttandanceSeq]);
  await pool.execute(
    `INSERT INTO device_attandance_hist
       (device_attandance_seq, company_code, branch_code, emp_id, LOGDATE, C1, C2, status, created_by, action)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      punch.device_attandance_seq, punch.company_code, punch.branch_code, punch.emp_id, punch.LOGDATE, punch.C1, punch.C2,
      newStatus, session.user.loginUserId, active ? 'Active' : 'Inactive',
    ]
  );

  if (await isOtEligibleDay(pool, day.empFkey, day.attDate)) {
    await pool.query('SELECT ot_duration_register_date(?, ?, ?)', [day.attDate, day.empFkey, day.branchCode]);
  }

  return NextResponse.json({ success: true });
}
