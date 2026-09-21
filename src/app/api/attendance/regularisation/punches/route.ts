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
  return NextResponse.json({ data: rows });
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
