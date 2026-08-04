import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

// Ports UserAccessController::saveBranchAccess() — the "Manage Branch" modal's Save button.
// Always writes branch mode (is_hierarchy='N'); switching back from hierarchy mode ("Set Branch
// Wise") lands here too, matching legacy exactly (that button just opens this same modal).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const featureId = Number(body.feature_id);
  const branches: string[] = Array.isArray(body.branches) ? body.branches : [];

  if (!featureId) {
    return NextResponse.json({ error: 'feature_id is required' }, { status: 400 });
  }
  if (!branches.length) {
    return NextResponse.json({ error: 'At least one branch must be selected' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  await pool.execute(
    "UPDATE user_feature_branch_access SET active = 'N' WHERE user_fkey = ? AND feature_fkey = ?",
    [id, featureId]
  );
  for (const branchCode of branches) {
    await pool.execute(
      "INSERT INTO user_feature_branch_access (user_fkey, feature_fkey, branch_fkey, is_hierarchy, active) VALUES (?, ?, ?, 'N', 'Y')",
      [id, featureId, branchCode]
    );
  }

  return NextResponse.json({ success: true });
}
