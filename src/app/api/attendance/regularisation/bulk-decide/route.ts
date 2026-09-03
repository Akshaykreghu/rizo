import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { decideRegularisation } from '@/lib/regularisation';
import { NextRequest, NextResponse } from 'next/server';

// Admin "select several pending requests, approve/reject all at once" — legacy's real
// bulkupdate() entry point (called with an array of ids from the admin grid's checkbox
// selection; this route's single-id counterpart in decide/route.ts is the narrower case).
// Runs each id through the same decideRegularisation() core sequentially (not a transaction —
// matches legacy's own per-row loop) so one bad row can't block the rest; failures are reported
// per id rather than failing the whole batch.

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { ids, decision, remarks } = body as { ids: number[]; decision: 'approve' | 'reject'; remarks?: string };
  if (!ids?.length || (decision !== 'approve' && decision !== 'reject')) {
    return NextResponse.json({ error: 'ids and a valid decision are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const succeeded: number[] = [];
  const failed: { id: number; reason: string }[] = [];

  for (const id of ids) {
    const result = await decideRegularisation(pool, id, decision, remarks, session.user.loginUserId);
    if (result.ok) succeeded.push(id);
    else failed.push({ id, reason: result.error ?? 'Failed' });
  }

  return NextResponse.json({ succeeded, failed });
}
