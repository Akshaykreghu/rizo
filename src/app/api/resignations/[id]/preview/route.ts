import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getTerminationContext, computeDayCountStats, previewEncashableLeaveBalance, getLoansAndAssets, getAllocatedAssets, hasCurrentLeaveYear } from '@/lib/settlement';

// Mirrors legacy's setup() screen: the read-only preview shown after "Process Full & Final" is
// clicked, BEFORE anything is actually computed/persisted — Resignation Details, Notice Period
// Adjustment stats (including Encashable Leave Balance, which the eligibility check doesn't
// surface), a "Balance Recovery" table of open loan accounts, and the list of assets still
// allocated to the employee. The actual commit (leave encashment + final_settle_pay_prc +
// settlement read-back) only happens when PUT .../approve is called next.

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
  const { loans } = await getLoansAndAssets(pool, ctx.empFkey);
  const allocatedAssets = await getAllocatedAssets(pool, ctx.empFkey);
  const leaveYearWarning = (await hasCurrentLeaveYear(pool, ctx.branchCode))
    ? null
    : 'You need to provide a Leave Year for this employee.';

  // Legacy setup.ctp "Balance Recovery" table: one row per open loan account, plus a
  // "Total Amount Balance" = sum of the outstanding balances.
  const loanRows = loans as unknown as Array<{
    emp_loan_pkey: number; loan_amount: number; emi_amount: number | null;
    opening_balance: number | null; closing_balance: number | null;
  }>;
  const balanceRecoveryRows = loanRows.map((l) => ({
    account: `${l.emp_loan_pkey} (${Number(l.emi_amount ?? 0).toFixed(2)} - EMI) - Loan Account`,
    status: 'Open',
    amount: Number(l.loan_amount ?? 0),
    balance: Number(l.opening_balance ?? l.closing_balance ?? 0),
  }));
  const totalAmountBalance = balanceRecoveryRows.reduce((sum, r) => sum + r.balance, 0);

  return NextResponse.json({
    employee: { first_name: ctx.firstName, last_name: ctx.lastName },
    resignationDetails: {
      submittedDate: ctx.submittedDate,
      noticePeriod: ctx.noticePeriod,
      lastWorkingDate: ctx.lastWorkingDate,
      approvedLastWorkingDate: ctx.lastApprovedWd,
    },
    noticePeriodAdjustments: { ...dayStats, encashableLeaveBalance },
    balanceRecovery: { rows: balanceRecoveryRows, totalAmountBalance },
    allocatedAssets,
    leaveYearWarning,
  });
}
