import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool, controlPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

interface MenuNode {
  menu_id: number;
  menu_title: string;
  children: MenuNode[];
}

interface MenuGroup {
  canonicalId: number;
  allIds: number[];
  menu_title: string;
  parent_id: number;
}

// The live `emp_menu` catalog has real, legacy-seeded duplicate rows — same parent/title/url,
// each with its own menu_id, all active='Y' (confirmed: e.g. "Attendance Regularisation" exists
// 3x, "Approve Regularisation" 2x under the same parent). Real employees already have grants
// scattered across different duplicate IDs for what is conceptually the same permission. Deleting
// rows from this live-migrated table risks silently dropping some employees' actual access, so
// duplicates are collapsed for display/toggling instead: rows sharing (parent_id, menu_title,
// menu_url) are grouped, the lowest menu_id represents the group everywhere the API surfaces IDs,
// and toggling that ID activates/deactivates every real ID in the group together.
function groupMenus(rows: RowDataPacket[]) {
  const groupByKey = new Map<string, MenuGroup>();
  for (const r of rows) {
    const key = `${r.parent_id}|${r.menu_title}|${r.menu_url ?? ''}`;
    let g = groupByKey.get(key);
    if (!g) {
      g = { canonicalId: r.menu_id, allIds: [], menu_title: r.menu_title, parent_id: r.parent_id };
      groupByKey.set(key, g);
    }
    g.allIds.push(r.menu_id);
    if (r.menu_id < g.canonicalId) g.canonicalId = r.menu_id;
  }

  const idToCanonical = new Map<number, number>();
  const canonicalToAllIds = new Map<number, number[]>();
  for (const g of groupByKey.values()) {
    for (const rid of g.allIds) idToCanonical.set(rid, g.canonicalId);
    canonicalToAllIds.set(g.canonicalId, g.allIds);
  }

  return { groups: [...groupByKey.values()], idToCanonical, canonicalToAllIds };
}

function buildTree(groups: MenuGroup[], idToCanonical: Map<number, number>): MenuNode[] {
  const nodeByCanonical = new Map<number, MenuNode>();
  for (const g of groups) {
    nodeByCanonical.set(g.canonicalId, { menu_id: g.canonicalId, menu_title: g.menu_title, children: [] });
  }
  const roots: MenuNode[] = [];
  for (const g of groups) {
    const node = nodeByCanonical.get(g.canonicalId)!;
    const parentCanonical = idToCanonical.get(g.parent_id);
    if (g.parent_id && parentCanonical !== undefined && nodeByCanonical.has(parentCanonical)) {
      nodeByCanonical.get(parentCanonical)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

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

  const [[menuRows], [accessRows], [featureRows], [featureAccessRows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      "SELECT menu_id, parent_id, menu_title, menu_url FROM emp_menu WHERE active = 'Y' ORDER BY parent_id, menu_title"
    ),
    pool.execute<RowDataPacket[]>(
      "SELECT menu_id FROM user_access WHERE user_fkey = ? AND active = 'Y' AND status = 1",
      [id]
    ),
    controlPool.execute<RowDataPacket[]>(
      'SELECT feature_id, feature_name, description FROM features ORDER BY display_order ASC'
    ),
    pool.execute<RowDataPacket[]>(
      "SELECT feature_fkey, branch_fkey, is_hierarchy FROM user_feature_branch_access WHERE user_fkey = ? AND active = 'Y'",
      [id]
    ),
  ]);

  const { groups, idToCanonical } = groupMenus(menuRows);
  const assignedCanonical = new Set<number>();
  for (const r of accessRows) {
    const canonical = idToCanonical.get(r.menu_id as number);
    if (canonical !== undefined) assignedCanonical.add(canonical);
  }

  const featureAccess: Record<number, { mode: 'branch' | 'hierarchy'; branches: string[] }> = {};
  for (const row of featureAccessRows) {
    const featureId = row.feature_fkey as number;
    if (!featureAccess[featureId]) featureAccess[featureId] = { mode: 'branch', branches: [] };
    if (row.is_hierarchy === 'Y') {
      featureAccess[featureId].mode = 'hierarchy';
    } else {
      featureAccess[featureId].branches.push(row.branch_fkey as string);
    }
  }

  return NextResponse.json({
    tree: buildTree(groups, idToCanonical),
    assigned: [...assignedCanonical],
    features: featureRows,
    featureAccess,
  });
}

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
  const canonicalMenuIds: number[] = body.menu_ids ?? [];
  const pool = await getCompanyPool(session.user.companyCode);

  const [menuRows] = await pool.execute<RowDataPacket[]>(
    "SELECT menu_id, parent_id, menu_title, menu_url FROM emp_menu WHERE active = 'Y'"
  );
  const { canonicalToAllIds, idToCanonical } = groupMenus(menuRows);

  // Expand each submitted canonical ID into every real duplicate menu_id in its group, so toggling
  // one group activates/deactivates all of the underlying legacy rows together.
  const menuIds = new Set<number>();
  for (const canonicalId of canonicalMenuIds) {
    for (const realId of canonicalToAllIds.get(canonicalId) ?? [canonicalId]) menuIds.add(realId);
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existingRows] = await connection.execute<RowDataPacket[]>(
      'SELECT user_access_pkey, menu_id FROM user_access WHERE user_fkey = ?',
      [id]
    );
    const existingByMenuId = new Map(existingRows.map((r) => [r.menu_id as number, r.user_access_pkey as number]));

    for (const menuId of menuIds) {
      const existingPkey = existingByMenuId.get(menuId);
      if (existingPkey !== undefined) {
        await connection.execute(
          "UPDATE user_access SET active = 'Y', status = 1 WHERE user_access_pkey = ?",
          [existingPkey]
        );
      } else {
        await connection.execute(
          "INSERT INTO user_access (organization_id, user_fkey, menu_id, active, status) VALUES ('1', ?, ?, 'Y', 1)",
          [id, menuId]
        );
      }
    }

    // Only deactivate rows whose menu_id is a known, currently-active menu (i.e. was offered as a
    // toggleable option) and wasn't in the submitted set — leave any other row (e.g. add-on feature
    // bookkeeping) untouched.
    const toDeactivate = existingRows.filter(
      (r) => idToCanonical.has(r.menu_id as number) && !menuIds.has(r.menu_id as number)
    );
    for (const row of toDeactivate) {
      await connection.execute(
        "UPDATE user_access SET active = 'N', status = 0 WHERE user_access_pkey = ?",
        [row.user_access_pkey]
      );
    }

    await connection.commit();
    return NextResponse.json({ success: true });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
