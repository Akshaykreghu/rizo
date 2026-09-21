import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { resolveMenuHref } from '@/lib/essMenuLinks';

// Self-service counterpart to /api/employees/menu-allocation/[id] (admin-only, lets an admin
// grant menu items to an employee). This route lets the logged-in employee read back exactly
// what was granted to them, so ESS Others can render it as a real (if partial) menu instead of
// a hardcoded list every employee sees regardless of what admin actually allocated.
//
// `emp_menu` has real legacy-seeded duplicate rows (same parent/title/url under different
// menu_ids — see the admin route's groupMenus for how this was confirmed); grouping by
// (parent_id, menu_title, menu_url) and keeping the first row avoids listing the same item twice.
interface MenuItem {
  menu_id: number;
  menu_title: string;
  menu_url: string | null;
  parent_title: string | null;
  href: string | null;
  iconCls: string | null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const empId = session.user.empFkey;
  if (!empId) return NextResponse.json([]);

  const pool = await getCompanyPool(session.user.companyCode);

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT m.menu_id, m.menu_title, m.menu_url, m.parent_id, m.iconCls, p.menu_title AS parent_title
     FROM user_access ua
     JOIN emp_menu m ON m.menu_id = ua.menu_id
     LEFT JOIN emp_menu p ON p.menu_id = m.parent_id
     WHERE ua.user_fkey = ? AND ua.active = 'Y' AND ua.status = 1 AND m.active = 'Y'
     ORDER BY m.parent_id, m.menu_title`,
    [empId]
  );

  // "Settings" (menu_url "User/profile") is a legacy account-settings page fully superseded by
  // the About Me self-edit page built for this app — surfacing it as a dead "Coming soon" tile
  // would just be confusing, so it's hidden rather than listed disabled like a genuinely
  // not-yet-built feature.
  const HIDDEN_MENU_URLS = new Set(['user/profile']);

  const seen = new Set<string>();
  const items: MenuItem[] = [];
  for (const r of rows) {
    const menuUrl = (r.menu_url as string) || '';
    // Blank or "#" menu_url is a legacy container/section heading, not a real destination —
    // only its children (which do have real urls) are worth listing.
    if (!menuUrl || menuUrl === '#') continue;
    if (HIDDEN_MENU_URLS.has(menuUrl.trim().toLowerCase())) continue;

    const key = `${r.parent_id}|${r.menu_title}|${menuUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      menu_id: r.menu_id as number,
      menu_title: r.menu_title as string,
      menu_url: menuUrl,
      parent_title: (r.parent_title as string) || null,
      href: resolveMenuHref(menuUrl),
      iconCls: (r.iconCls as string) || null,
    });
  }

  return NextResponse.json(items);
}
