import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { decideRegularisation } from '@/lib/regularisation';
import { NextRequest, NextResponse } from 'next/server';

// Fixed port of RegularisationController::bulkupdate() for a single row — see
// lib/regularisation.ts for the full behavior notes (bug-fix vs. legacy, punch swap logic) and
// bulk-decide/route.ts for the multi-row admin flow that shares this same core.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { decision, remarks } = body as { decision: 'approve' | 'reject'; remarks?: string };
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  // Admin (userGroup 1) may decide any request. A hierarchy approver (userGroup 2) may only
  // decide requests routed to them — legacy sets employee_regularaization.approved_person to the
  // requester's emp_proff.attr1 hierarchy head at raise time (RegularisationController::
  // bulkupdate_self()/savenew(), line ~2168-2174) and hierarchyindex.ctp posts to the very same
  // Regularisation/bulkupdate action admins use, with no extra ownership check in bulkupdate()
  // itself beyond what the listing already filtered to. We enforce the equivalent check here.
  if (session.user.userGroup !== 1) {
    const [[reg]] = await pool.execute<import('mysql2').RowDataPacket[]>(
      'SELECT approved_person FROM employee_regularaization WHERE id = ?',
      [Number(id)]
    );
    if (!reg) return NextResponse.json({ error: 'Regularisation request not found' }, { status: 404 });
    if (String(reg.approved_person ?? '') !== String(session.user.empFkey ?? '')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const result = await decideRegularisation(pool, Number(id), decision, remarks, session.user.loginUserId);
  if (!result.ok) {
    const status = result.error === 'Regularisation request not found' ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ success: true, decision });
}
