import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports ScheduledBreakOffController — legacy's "Scheduled Break-Off", shown in the menu as
// "Special Events Attendance". Overrides a date's computed attendance for specific employees:
// type 'attendance' (legacy 'A') = treat as present/working despite the day normally being a
// weekoff/holiday (e.g. calling people in for an event), optionally first-half only; type
// 'weekoff' (legacy 'W') = force a week-off on what would otherwise be a working day.
// Table: scheduled_break_off. After any change, re-runs time_duration_check so the Register
// reflects the override immediately (same recompute proc used by punches/regularisation).

const TYPE_MAP: Record<string, string> = { attendance: 'A', weekoff: 'W' };

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  const type = searchParams.get('type') ?? 'attendance';
  if (!date || !TYPE_MAP[type]) {
    return NextResponse.json({ error: 'date and a valid type are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT sbo.emp_fkey, sbo.first_half, sbo.message, ed.emp_id, ed.first_name, ed.last_name, b.branch_name
     FROM scheduled_break_off sbo
     JOIN emp_details ed ON ed.emp_pkey = sbo.emp_fkey
     LEFT JOIN branches b ON b.branch_code = ed.branch_code
     WHERE sbo.break_off_date = ? AND sbo.type = ? AND sbo.status = 1
     ORDER BY ed.first_name`,
    [date, TYPE_MAP[type]]
  );

  return NextResponse.json({ data: rows });
}

async function runTimeDurationCheck(
  pool: Awaited<ReturnType<typeof getCompanyPool>>,
  yearMonth: string,
  empFkey: number
): Promise<{ ok: boolean; branchCode: string | null }> {
  const [[emp]] = await pool.execute<RowDataPacket[]>(
    'SELECT branch_code FROM emp_details WHERE emp_pkey = ?',
    [empFkey]
  );
  if (!emp) return { ok: false, branchCode: null };
  try {
    const [[result]] = await pool.query<RowDataPacket[]>(
      'SELECT time_duration_check(?, ?, ?) AS r',
      [yearMonth, empFkey, emp.branch_code]
    );
    return { ok: !!result?.r, branchCode: emp.branch_code };
  } catch {
    return { ok: false, branchCode: emp.branch_code };
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { empFkeys, date, month, type, message, firstHalf } = body as {
    empFkeys: number[]; date: string; month: string; type: 'attendance' | 'weekoff';
    message?: string; firstHalf?: boolean;
  };
  if (!empFkeys?.length || !date || !month || !TYPE_MAP[type]) {
    return NextResponse.json({ error: 'empFkeys, date, month and a valid type are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const legacyType = TYPE_MAP[type];
  const yearMonth = `${month}-01`;
  const failed: { empFkey: number; reason: string }[] = [];

  for (const empFkey of empFkeys) {
    const [[existing]] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM scheduled_break_off WHERE emp_fkey = ? AND type = ? AND break_off_date = ?',
      [empFkey, legacyType, date]
    );

    if (existing) {
      await pool.execute(
        `UPDATE scheduled_break_off SET status = 1, modified_by = ?, modification_date = CURDATE() WHERE id = ?`,
        [session.user.loginUserId, existing.id]
      );
    } else {
      const breakOffMsg = `Break off applied on ${date}${message ? ' for ' + message : ''}`;
      await pool.execute(
        `INSERT INTO scheduled_break_off
           (type, emp_fkey, break_off_date, message, break_off_msg, first_half, created_by, creation_date, modified_by, modification_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE(), '', '0000-00-00', 1)`,
        [legacyType, empFkey, date, message ?? '', breakOffMsg, type === 'attendance' && firstHalf ? 'Y' : 'N', session.user.loginUserId]
      );
    }

    const { ok } = await runTimeDurationCheck(pool, yearMonth, empFkey);
    if (!ok) failed.push({ empFkey, reason: 'Employee does not have any shift policy assigned' });
  }

  return NextResponse.json({ success: true, failed });
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { empFkeys, date, month, type } = body as {
    empFkeys: number[]; date: string; month: string; type: 'attendance' | 'weekoff';
  };
  if (!empFkeys?.length || !date || !month || !TYPE_MAP[type]) {
    return NextResponse.json({ error: 'empFkeys, date, month and a valid type are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const legacyType = TYPE_MAP[type];
  const yearMonth = `${month}-01`;
  const skipped: number[] = [];

  for (const empFkey of empFkeys) {
    const [[verified]] = await pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM attendance_register WHERE isdelete = 'N' AND emp_fkey = ? AND month_year = ? LIMIT 1`,
      [empFkey, month]
    );
    if (verified) {
      // Matches legacy: attendance already verified for the month blocks removal (though not
      // addition — that asymmetry is legacy's own behavior, not a port bug).
      skipped.push(empFkey);
      continue;
    }

    await pool.execute(
      `UPDATE scheduled_break_off
       SET status = 0, first_half = 'N', message = '', break_off_msg = '', modified_by = ?, modification_date = CURDATE()
       WHERE emp_fkey = ? AND type = ? AND break_off_date = ?`,
      [session.user.loginUserId, empFkey, legacyType, date]
    );

    // Purge this employee's cached computed rows for the whole month (guarded: never a row still
    // covered by verified attendance, never a date with a live manual daily-OT entry) so
    // time_duration_check regenerates them cleanly without the override baked in. Matches
    // legacy's removeEmpFromSBO() exactly, including the whole-month (not just this date) scope.
    await pool.execute(
      `DELETE FROM emp_detail_timeattandance
       WHERE emp_pkey = ? AND yearmonth = ?
         AND emp_pkey NOT IN (
           SELECT emp_fkey FROM attendance_register WHERE isdelete = 'N' AND month_year = ?
         )
         AND att_date NOT IN (
           SELECT att_date FROM emp_ot_timeattandance WHERE emp_pkey = ? AND yearmonth = ? AND isdelete = 'N'
         )`,
      [empFkey, yearMonth, month, empFkey, yearMonth]
    );

    await runTimeDurationCheck(pool, yearMonth, empFkey);
  }

  return NextResponse.json({ success: true, skipped });
}
