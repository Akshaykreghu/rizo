import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { AUDIENCE_MATCH_SQL, LIVE_SQL, ensureAnnouncementTables } from '@/lib/announcements';

// The logged-in employee's live announcements for the ESS home "Company Updates" panel —
// only ones addressed to everyone, to them by name, or to their branch/department/designation.
// Pinned first, then Emergency > Important > Information, newest first within each.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.empFkey) return NextResponse.json({ data: [] });

  const pool = await getCompanyPool(session.user.companyCode);
  await ensureAnnouncementTables(pool);

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT a.announcement_pkey, a.title, a.message, a.category, a.is_pinned,
            DATE_FORMAT(a.publish_from, '%Y-%m-%d') AS publish_from,
            DATE_FORMAT(a.expires_on, '%Y-%m-%d') AS expires_on,
            (r.emp_fkey IS NOT NULL) AS is_read
     FROM announcements a
     JOIN emp_details e ON e.emp_pkey = ?
     LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
     LEFT JOIN announcement_reads r ON r.announcement_fkey = a.announcement_pkey AND r.emp_fkey = e.emp_pkey
     WHERE ${LIVE_SQL} AND ${AUDIENCE_MATCH_SQL}
     ORDER BY a.is_pinned DESC, FIELD(a.category, 'Emergency', 'Important', 'Information'),
              a.publish_from DESC, a.announcement_pkey DESC
     LIMIT 100`,
    [session.user.empFkey]
  );

  return NextResponse.json({
    data: rows.map((r) => ({ ...r, is_pinned: Number(r.is_pinned) === 1, is_read: Number(r.is_read) === 1 })),
  });
}
