import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { approveEncashmentEntry } from '@/lib/leaveEncashment';
import { NextRequest, NextResponse } from 'next/server';

// Bulk counterpart to [id]/approve — ports verifyregisterentries() (controller.php:589-621), the
// multi-select "Encash" checkbox action from the HR grid (addleave.ctp). Loops sequentially, not in
// a transaction, so one bad row doesn't block the rest (same precedent as
// attendance/regularisation/bulk-decide).
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { ids, approvedDaysById, month } = body as { ids: number[]; approvedDaysById?: Record<number, number>; month?: string };
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids is required' }, { status: 400 });
  }
  // verifyregisterentries() stamps approved_date to the 1st of the grid's selected filter month
  // (controller.php:595, 614), not today — unlike the single-row encashemp() approve action.
  const approvedDate = month ? `${month}-01` : undefined;

  const pool = await getCompanyPool(session.user.companyCode);
  const succeeded: number[] = [];
  const failed: { id: number; reason: string }[] = [];

  for (const id of ids) {
    const approvedDays = approvedDaysById?.[id] ?? null;
    const result = await approveEncashmentEntry(pool, id, approvedDays, session.user.loginUserId, approvedDate);
    if (result.ok) succeeded.push(id);
    else failed.push({ id, reason: result.error });
  }

  return NextResponse.json({ succeeded, failed });
}
