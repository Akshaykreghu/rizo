import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { approveAdvanceRequest } from '@/lib/advances';
import { NextRequest, NextResponse } from 'next/server';

// Admin-only. Approving works exactly like the admin's direct "New Advance" flow — same
// createAdvance() insert — see approveAdvanceRequest() in lib/advances.ts.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  try {
    const { advanceId } = await approveAdvanceRequest(pool, Number(id), session.user.loginUserId);
    return NextResponse.json({ success: true, advanceId });
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (err instanceof Error && err.message === 'NOT_PENDING') {
      return NextResponse.json({ error: 'Only a Pending request can be approved' }, { status: 409 });
    }
    throw err;
  }
}
