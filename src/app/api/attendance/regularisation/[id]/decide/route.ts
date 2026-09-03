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
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { decision, remarks } = body as { decision: 'approve' | 'reject'; remarks?: string };
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const result = await decideRegularisation(pool, Number(id), decision, remarks, session.user.loginUserId);
  if (!result.ok) {
    const status = result.error === 'Regularisation request not found' ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ success: true, decision });
}
