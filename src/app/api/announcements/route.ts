import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import {
  AUDIENCE_MATCH_SQL, ensureAnnouncementTables, loadTargets, parseAnnouncementInput, saveTargets,
} from '@/lib/announcements';

// Admin management of company announcements. Employees read theirs via /api/ess/announcements.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  await ensureAnnouncementTables(pool);

  // status: 'Scheduled' (publish date still ahead), 'Expired' (past its expiry) or 'Live'.
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT a.announcement_pkey, a.title, a.message, a.category, a.is_pinned, a.audience_type,
            DATE_FORMAT(a.publish_from, '%Y-%m-%d') AS publish_from,
            DATE_FORMAT(a.expires_on, '%Y-%m-%d') AS expires_on,
            a.created_by, DATE_FORMAT(a.created_date, '%Y-%m-%d %H:%i') AS created_date,
            a.updated_by, DATE_FORMAT(a.updated_date, '%Y-%m-%d %H:%i') AS updated_date,
            CASE
              WHEN a.publish_from > CURDATE() THEN 'Scheduled'
              WHEN a.expires_on IS NOT NULL AND a.expires_on < CURDATE() THEN 'Expired'
              ELSE 'Live'
            END AS status,
            (SELECT COUNT(DISTINCT e.emp_pkey)
               FROM emp_details e LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
              WHERE e.status = 1 AND ${AUDIENCE_MATCH_SQL}) AS recipient_count,
            (SELECT COUNT(*) FROM announcement_reads r WHERE r.announcement_fkey = a.announcement_pkey) AS read_count
     FROM announcements a
     WHERE a.active = 1
     ORDER BY a.is_pinned DESC, a.publish_from DESC, a.announcement_pkey DESC
     LIMIT 500`
  );

  const targets = await loadTargets(pool, rows.map((r) => r.announcement_pkey));
  return NextResponse.json({
    data: rows.map((r) => ({ ...r, is_pinned: Number(r.is_pinned) === 1, targets: targets.get(r.announcement_pkey) ?? [] })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { input, error } = parseAnnouncementInput(await request.json());
  if (!input) return NextResponse.json({ error }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  await ensureAnnouncementTables(pool);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO announcements
         (title, message, category, is_pinned, audience_type, publish_from, expires_on, created_by, created_date, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 1)`,
      [
        input.title, input.message, input.category, input.isPinned ? 1 : 0, input.audienceType,
        input.publishFrom, input.expiresOn, session.user.loginUserId,
      ]
    );
    await saveTargets(conn, result.insertId, input.targets);
    await conn.commit();
    return NextResponse.json({ id: result.insertId }, { status: 201 });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
