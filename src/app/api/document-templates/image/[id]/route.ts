import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT t.id, t.name, t.type, t.image, t.imageLeft, t.imageTop, t.imagesize, t.imageHeight, t.is_default,
            d.text_content, d.left_axis, d.top_axis
     FROM templates t
     LEFT JOIN templates_details d
       ON d.id = (SELECT id FROM templates_details WHERE templateid = t.id ORDER BY id DESC LIMIT 1)
     WHERE t.id = ? AND t.status = 1`,
    [id]
  );
  if (!row) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  return NextResponse.json(row);
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
  const pool = await getCompanyPool(session.user.companyCode);

  // savedefault_template(): only one default per type.
  if (body.setDefault) {
    const [[t]] = await pool.execute<RowDataPacket[]>('SELECT type FROM templates WHERE id = ?', [id]);
    if (t) {
      await pool.execute('UPDATE templates SET is_default = 0 WHERE status = 1 AND type = ?', [t.type]);
      await pool.execute('UPDATE templates SET is_default = 1 WHERE id = ?', [id]);
    }
    return NextResponse.json({ success: true });
  }

  // save_template(): update geometry on `templates`, append a new `templates_details` row.
  await pool.execute(
    `UPDATE templates SET name = ?, type = ?, image = ?, imageLeft = ?, imageTop = ?, imagesize = ?, imageHeight = ?
     WHERE id = ?`,
    [
      body.name ?? 'Untitled', body.type ?? 'certificate', body.image ?? null,
      Number(body.imageLeft ?? 0), Number(body.imageTop ?? 0),
      Number(body.imagesize ?? 120), Number(body.imageHeight ?? 120),
      id,
    ]
  );
  await pool.execute(
    `INSERT INTO templates_details (templateid, text_content, left_axis, top_axis) VALUES (?, ?, ?, ?)`,
    [id, body.text_content ?? '', Number(body.left_axis ?? 0), Number(body.top_axis ?? 0)]
  );

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  await pool.execute('UPDATE templates SET status = 0 WHERE id = ?', [id]);
  return NextResponse.json({ success: true });
}
