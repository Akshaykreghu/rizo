import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// CRUD for legacy's image-certificate templates (DocumentManagerController::template()/
// save_template()/savedefault_template()). Two tables — `templates` (background image + photo-box
// geometry + is_default per type) and `templates_details` (the positioned text block; legacy
// appends a row per save and reads the latest with ORDER BY id DESC LIMIT 1). Run
// scripts/create-image-templates.mjs once per tenant if these tables don't exist yet.

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  try {
    const params: string[] = [];
    let where = 'WHERE t.status = 1';
    if (type) { where += ' AND t.type = ?'; params.push(type); }

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT t.id, t.name, t.type, t.image, t.imageLeft, t.imageTop, t.imagesize, t.imageHeight,
              t.is_default,
              d.text_content, d.left_axis, d.top_axis
       FROM templates t
       LEFT JOIN templates_details d
         ON d.id = (SELECT id FROM templates_details WHERE templateid = t.id ORDER BY id DESC LIMIT 1)
       ${where}
       ORDER BY t.id DESC`,
      params
    );
    return NextResponse.json(rows);
  } catch {
    // Tables not created for this tenant yet.
    return NextResponse.json({ error: 'image_templates_unavailable' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO templates (name, type, image, imageLeft, imageTop, imagesize, imageHeight, is_default, status, created_by, creation_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, NOW())`,
    [
      body.name ?? 'Untitled', body.type ?? 'certificate', body.image ?? null,
      Number(body.imageLeft ?? 0), Number(body.imageTop ?? 0),
      Number(body.imagesize ?? 120), Number(body.imageHeight ?? 120),
      session.user.loginUserId,
    ]
  );
  await pool.execute(
    `INSERT INTO templates_details (templateid, text_content, left_axis, top_axis) VALUES (?, ?, ?, ?)`,
    [result.insertId, body.text_content ?? '', Number(body.left_axis ?? 0), Number(body.top_axis ?? 0)]
  );

  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
