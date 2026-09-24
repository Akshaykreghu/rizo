import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { decideAssetRequest, type ApproveDetails } from '@/lib/assetRequests';
import { NextRequest, NextResponse } from 'next/server';

// Admin-only approve/reject of an emp_asset_request row. Mirrors
// /api/attendance/regularisation/[id]/decide/route.ts's shape exactly.
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
  const {
    decision, remarks, assetState, description, officialMail, officialContact, crmId, allocatedOfcSpace,
  } = body as {
    decision: 'approve' | 'reject'; remarks?: string;
    assetState?: string; description?: string; officialMail?: string; officialContact?: string;
    crmId?: string; allocatedOfcSpace?: string;
  };
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 });
  }

  const approveDetails: ApproveDetails | undefined = decision === 'approve'
    ? { assetState, description, officialMail, officialContact, crmId, allocatedOfcSpace }
    : undefined;

  const pool = await getCompanyPool(session.user.companyCode);
  const result = await decideAssetRequest(pool, Number(id), decision, remarks, session.user.loginUserId, approveDetails);
  if (!result.ok) {
    const status = result.error === 'Asset request not found' ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ success: true, decision });
}
