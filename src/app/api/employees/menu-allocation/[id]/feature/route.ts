import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports UserAccessController::saveFeatureAccess() — the "Add-on Menus" toggle. Turning a feature
// ON in hierarchy mode writes one sentinel row (branch_fkey='n', is_hierarchy='Y'); turning it ON
// in branch mode defaults to ALL active branches (matches legacy's "Defaults to all" choice-modal
// copy — the admin narrows this afterward via PUT .../feature/branches, legacy's "Manage Branch").
// Turning OFF just deactivates every row for this user+feature. Deliberately does NOT also write
// the parallel `user_access` row legacy's save() writes (always `menu_id = 0`, a dead value that
// can never match a real feature_id in the .ctp's own isAllocated check) — that write is
// self-evidently vestigial in legacy, not a real source of truth; `user_feature_branch_access` is.
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
  const active = body.active === 'Y' || body.active === true;
  const mode: 'branch' | 'hierarchy' = body.mode === 'hierarchy' ? 'hierarchy' : 'branch';

  if (!featureId) {
    return NextResponse.json({ error: 'feature_id is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  await pool.execute(
    "UPDATE user_feature_branch_access SET active = 'N' WHERE user_fkey = ? AND feature_fkey = ?",
    [id, featureId]
  );

  if (active) {
    if (mode === 'hierarchy') {
      await pool.execute(
        "INSERT INTO user_feature_branch_access (user_fkey, feature_fkey, branch_fkey, is_hierarchy, active) VALUES (?, ?, 'n', 'Y', 'Y')",
        [id, featureId]
      );
    } else {
      const [branches] = await pool.execute<RowDataPacket[]>(
        'SELECT branch_code FROM branches WHERE status = 1'
      );
      for (const b of branches) {
        await pool.execute(
          "INSERT INTO user_feature_branch_access (user_fkey, feature_fkey, branch_fkey, is_hierarchy, active) VALUES (?, ?, ?, 'N', 'Y')",
          [id, featureId, b.branch_code]
        );
      }
    }
  }

  return NextResponse.json({ success: true });
}
