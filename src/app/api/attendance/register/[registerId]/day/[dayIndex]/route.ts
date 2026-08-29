import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getRegisterDayContext, isLeaveAlreadyApplied, isLeaveCode, toISODate } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';

// Ports chnagestatus() (parameterized — legacy's version had a real SQL-injection surface via raw
// string concatenation). statusType: 'first' | 'second' | 'full' -> leave session 1 | 2 | 3.
// If the new status is a leave code, auto-creates+approves a leave transaction via
// leave_transaction_prc (matches legacy's AddLeave() side effect — ported per project decision,
// even though there's no Leave Management UI yet, same precedent as calling leave_encash_prc for
// Remove Employee without a Leave module existing).

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

    if (isLeaveCode(status) && salaryHeadItemFkey) {
      const approverId = session.user.empFkey ?? 0;
      const fromHalf = leaveSession === 2 ? 2 : 1;
      const toHalf = leaveSession === 1 ? 1 : 2;
      const leaveDays = leaveSession === 3 ? 1 : 0.5;

      const [insertResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO leaveentries
           (salary_head_item_fkey, applied_date, LEAVESTATUS, EMP_fkey, FROMDATE, FROMHALF, TODATE, TOHALF,
            ISAutherized, ISAutherizedby, ISAPPROVED, APPROVEDBY, Reason, leave_days)
         VALUES (?, CURDATE(), 'Approved', ?, ?, ?, ?, ?, 1, ?, 1, ?, 'Leave applied through status change', ?)`,
        [salaryHeadItemFkey, day.empFkey, attDate, fromHalf, attDate, toHalf, approverId, approverId, leaveDays]
      );
      const leaveEntryId = insertResult.insertId;

      await connection.query('CALL leave_transaction_prc(?, ?, ?, ?, ?, ?, ?, ?, @err)', [
        leaveEntryId, day.empFkey, attDate, fromHalf, attDate, toHalf, leaveDays, 'Applied',
      ]);
      await connection.query('CALL leave_transaction_prc(?, ?, ?, ?, ?, ?, ?, ?, @err)', [
        leaveEntryId, day.empFkey, attDate, fromHalf, attDate, toHalf, leaveDays, 'Approved',
      ]);
    }

    await connection.execute(
      `UPDATE attendance_register SET ${fieldCol} = ? WHERE registerid = ?`,
      [status, registerId]
    );

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  return NextResponse.json({ success: true, attDate: toISODate(attDate) });
}
