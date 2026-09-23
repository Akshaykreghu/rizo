import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { getPunchesForEmployeeDate, addPunch } from '@/lib/regularisation';
import { NextRequest, NextResponse } from 'next/server';

// Admin punch-editing tool for the Attendance Regularisation page's new "Action" column — ports
// RegularisationController's editpunch.ctp modal (list punches for an employee/date, add a new one)
// and savenew() (see lib/regularisation.ts for full behavior notes and legacy line refs). Admin-only:
// legacy's remove()/savenew() have no session/role guard at all, but this is a destructive,
// authoritative action, so it's gated to userGroup 1 here — same precedent as this codebase's other
// admin-scoped destructive actions (e.g. leave's bulk-delete).

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const empId = searchParams.get('empId');
  const attDate = searchParams.get('attDate');
  if (!empId || !attDate) {
    return NextResponse.json({ error: 'empId and attDate are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const rows = await getPunchesForEmployeeDate(pool, empId, attDate);
  // LOGDATE is read back as a JS Date built with the pool's timezone: '+00:00' setting, so it must be
  // formatted as a plain local wall-clock string here rather than left for the client to re-parse with
  // `new Date(...)` — that re-parse applies the browser's own timezone offset on top, shifting the
  // displayed time (e.g. a stored 09:15:54 rendering as 3:20 PM instead).
  const data = rows.map((r) => {
    const logDate = r.LOGDATE as unknown;
    return { ...r, LOGDATE: logDate instanceof Date ? formatLocalDateTime(logDate) : r.LOGDATE };
  });
  return NextResponse.json({ data });
}

function formatLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { empId, attDate, logTime, direction, remarks } = body as {
    empId: string; attDate: string; logTime: string; direction: 'in' | 'out'; remarks?: string;
  };
  if (!empId || !attDate || !logTime || !direction) {
    return NextResponse.json({ error: 'empId, attDate, logTime and direction are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  try {
    const result = await addPunch(pool, empId, attDate, logTime, direction, remarks ?? '', session.user.loginUserId);
    return NextResponse.json({ success: true, id: result.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add punch';
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
