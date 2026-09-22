import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool, realInstant } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Whether the employee is currently checked in and how long they've been working today, derived
// fresh from today's device_attandance rows rather than a separate cached "last punch" value —
// legacy (Controller/DashboardController.php) kept two sources of truth for this (last_punch_fn()
// for the button state, a separate Timers() for the elapsed clock) and its own comments record
// them disagreeing right after a real punch, leaving the wrong button showing. Computing both from
// one query here removes that class of bug entirely.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.empFkey) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [[emp]] = await pool.execute<RowDataPacket[]>(
    `SELECT emp_id FROM emp_details WHERE emp_pkey = ?`,
    [session.user.empFkey]
  );
  if (!emp) return NextResponse.json({ checkedIn: false, elapsedSeconds: 0, lastPunch: null });

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT LOGDATE, DIRECTION FROM device_attandance
     WHERE emp_id = ? AND status = 'Y' AND DATE(LOGDATE) = CURDATE()
     ORDER BY LOGDATE ASC`,
    [emp.emp_id]
  );

  let elapsedSeconds = 0;
  let openIn: Date | null = null;
  for (const r of rows) {
    const dir = String(r.DIRECTION).toLowerCase();
    const ts = realInstant(r.LOGDATE as Date)!;
    if (dir === 'in') {
      openIn = ts;
    } else if (dir === 'out' && openIn) {
      elapsedSeconds += Math.max(0, (ts.getTime() - openIn.getTime()) / 1000);
      openIn = null;
    }
  }
  const checkedIn = openIn !== null;
  if (checkedIn && openIn) {
    // openIn is now a real, correctly-anchored instant (see realInstant()), so this is safe to
    // diff directly against Date.now() — mixing a mislabeled DB read with a genuine wall-clock
    // value here previously went negative and clamped to 0 on every still-checked-in view.
    elapsedSeconds += Math.max(0, (Date.now() - openIn.getTime()) / 1000);
  }

  const last = rows.length > 0 ? rows[rows.length - 1] : null;
  return NextResponse.json({
    checkedIn,
    elapsedSeconds: Math.round(elapsedSeconds),
    lastPunch: last ? { time: realInstant(last.LOGDATE as Date)!.toISOString(), direction: String(last.DIRECTION).toLowerCase() } : null,
  });
}
