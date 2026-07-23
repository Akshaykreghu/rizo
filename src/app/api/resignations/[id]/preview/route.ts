import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getTerminationContext, computeDayCountStats, previewEncashableLeaveBalance, getLoansAndAssets } from '@/lib/settlement';

// Mirrors legacy's setup() screen: the read-only preview shown after "Process Full & Final" is
// clicked, BEFORE anything is actually computed/persisted — Resignation Details, Notice Period
// Adjustment stats (including Encashable Leave Balance, which the eligibility check doesn't
// surface), and read-only Loans/Assets reference panels. The actual commit (leave encashment +
// final_settle_pay_prc + settlement read-back) only happens when PUT .../approve is called next.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const ctx = await getTerminationContext(pool, id);
  if (!ctx) return NextResponse.json({ error: 'Resignation request not found' }, { status: 404 });

  const dayStats = await computeDayCountStats(pool, ctx, 0);
  const encashableLeaveBalance = await previewEncashableLeaveBalance(pool, ctx.empFkey, ctx.lastApprovedWd);
  const { loans, assets } = await getLoansAndAssets(pool, ctx.empFkey);

  return NextResponse.json({
    employee: { first_name: ctx.firstName, last_name: ctx.lastName },
    resignationDetails: {
      submittedDate: ctx.submittedDate,
      noticePeriod: ctx.noticePeriod,
      lastWorkingDate: ctx.lastWorkingDate,
      approvedLastWorkingDate: ctx.lastApprovedWd,
    },
    noticePeriodAdjustments: { ...dayStats, encashableLeaveBalance },
    loans,
    assets,
  });
}
