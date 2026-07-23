import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

interface MenuNode {
  menu_id: number;
  menu_title: string;
  children: MenuNode[];
}

function buildTree(rows: RowDataPacket[]): MenuNode[] {
  const byId = new Map<number, MenuNode>();
  rows.forEach((r) => byId.set(r.menu_id, { menu_id: r.menu_id, menu_title: r.menu_title, children: [] }));
  const roots: MenuNode[] = [];
  rows.forEach((r) => {
    const node = byId.get(r.menu_id)!;
    if (r.parent_id && byId.has(r.parent_id)) {
      byId.get(r.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
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

  const [[menuRows], [accessRows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      "SELECT menu_id, parent_id, menu_title FROM emp_menu WHERE active = 'Y' ORDER BY parent_id, menu_title"
    ),
    pool.execute<RowDataPacket[]>(
      "SELECT menu_id FROM user_access WHERE user_fkey = ? AND active = 'Y' AND status = 1",
      [id]
    ),
  ]);

  return NextResponse.json({
    tree: buildTree(menuRows),
    assigned: accessRows.map((r) => r.menu_id),
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
  const menuIds: number[] = body.menu_ids ?? [];
  const pool = await getCompanyPool(session.user.companyCode);

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

    const toDeactivate = existingRows.filter((r) => !menuIds.includes(r.menu_id as number));
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
