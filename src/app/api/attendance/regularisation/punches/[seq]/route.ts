import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { deactivatePunch } from '@/lib/regularisation';
import { NextRequest, NextResponse } from 'next/server';

// Ports RegularisationController::remove() — see lib/regularisation.ts's deactivatePunch() for the
// full 'D' vs 'N' status note (legacy's literal 'D' is dead/inconsistent; live data and this
// codebase's own decideRegularisation() only ever use 'N' for a deactivated punch, so that's what
// this uses). Admin-only, same reasoning as the sibling POST route in ../route.ts.

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ seq: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { seq } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  await deactivatePunch(pool, Number(seq));
  return NextResponse.json({ success: true });
}
