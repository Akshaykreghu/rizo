import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { approveEncashmentEntry } from '@/lib/leaveEncashment';
import { NextRequest, NextResponse } from 'next/server';

// Ports LeaveEncashmentRequestController::encashemp() — the real live single-record approval path
// (verifyregisterentries() is the bulk/legacy-scheduler variant, same underlying update+proc call,
// covered here by bulk-approve/route.ts sharing approveEncashmentEntry()). approved_by hardcoded to
// '0' matching legacy's own real call site exactly (not the requesting employee's chosen approver).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const approvedDays = (body as { approvedDays?: number }).approvedDays;

  const pool = await getCompanyPool(session.user.companyCode);
  const result = await approveEncashmentEntry(pool, Number(id), approvedDays ?? null, session.user.loginUserId);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, procMessage: result.procMessage });
}
