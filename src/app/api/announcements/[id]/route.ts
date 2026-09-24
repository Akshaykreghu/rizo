import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { ensureAnnouncementTables, parseAnnouncementInput, saveTargets } from '@/lib/announcements';

async function adminPool() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) return null;
  const pool = await getCompanyPool(session.user.companyCode);
  await ensureAnnouncementTables(pool);
  return { session, pool };
}

async function exists(pool: Awaited<ReturnType<typeof getCompanyPool>>, id: string) {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    'SELECT announcement_pkey FROM announcements WHERE announcement_pkey = ? AND active = 1',
    [id]
  );
  return !!row;
}

// Full replace of an announcement and its audience. Read receipts are kept, so editing a typo
// doesn't make everyone's copy look unread again.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await adminPool();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await exists(ctx.pool, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { input, error } = parseAnnouncementInput(await request.json());
  if (!input) return NextResponse.json({ error }, { status: 400 });

  const conn = await ctx.pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE announcements
       SET title = ?, message = ?, category = ?, is_pinned = ?, audience_type = ?, publish_from = ?,
           expires_on = ?, updated_by = ?, updated_date = NOW()
       WHERE announcement_pkey = ?`,
      [
        input.title, input.message, input.category, input.isPinned ? 1 : 0, input.audienceType,
        input.publishFrom, input.expiresOn, ctx.session.user.loginUserId, id,
      ]
    );
    await saveTargets(conn, Number(id), input.targets);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return NextResponse.json({ success: true });
}

// Quick pin/unpin from the list without resending the whole announcement.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await adminPool();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await exists(ctx.pool, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json();
  if (typeof body.isPinned !== 'boolean') {
    return NextResponse.json({ error: 'isPinned is required' }, { status: 400 });
  }
  await ctx.pool.execute(
    'UPDATE announcements SET is_pinned = ?, updated_by = ?, updated_date = NOW() WHERE announcement_pkey = ?',
    [body.isPinned ? 1 : 0, ctx.session.user.loginUserId, id]
  );
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await adminPool();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await exists(ctx.pool, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await ctx.pool.execute(
    'UPDATE announcements SET active = 0, updated_by = ?, updated_date = NOW() WHERE announcement_pkey = ?',
    [ctx.session.user.loginUserId, id]
  );
  return NextResponse.json({ success: true });
}
