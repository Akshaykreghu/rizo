import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { AUDIENCE_MATCH_SQL, LIVE_SQL, ensureAnnouncementTables } from '@/lib/announcements';

// Records the first time the logged-in employee opened an announcement. Only accepted for an
// announcement that is live and actually addressed to them, so read counts can't be padded.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.empFkey) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  await ensureAnnouncementTables(pool);

  const [[visible]] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 AS ok
     FROM announcements a
     JOIN emp_details e ON e.emp_pkey = ?
     LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
     WHERE a.announcement_pkey = ? AND ${LIVE_SQL} AND ${AUDIENCE_MATCH_SQL}`,
    [session.user.empFkey, id]
  );
  if (!visible) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await pool.execute(
    'INSERT IGNORE INTO announcement_reads (announcement_fkey, emp_fkey, read_at) VALUES (?, ?, NOW())',
    [id, session.user.empFkey]
  );
  return NextResponse.json({ success: true });
}
