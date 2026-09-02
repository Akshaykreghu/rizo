import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { buildMergeTokens } from '@/lib/documentMerge';
import { buildTemplateHtml, resolveTemplateText } from '@/lib/imageTemplate';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Resolves an image-certificate template for one employee: merges the positioned text block
// against that employee's data (legacy renderImageTempalte() only str_replace's {{first_name}}/
// {{last_name}}; we also expose the full buildMergeTokens set) and returns the geometry + a
// ready-to-render HTML fragment. The actual PNG/PDF is produced client-side from this.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const empFkey = Number(id);
  const body = await request.json();
  const templateId = Number(body.template_id);
  if (!templateId) return NextResponse.json({ error: 'template_id is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);

  const [[tpl]] = await pool.execute<RowDataPacket[]>(
    `SELECT t.id, t.name, t.type, t.image, t.imageLeft, t.imageTop, t.imagesize, t.imageHeight,
            d.text_content, d.left_axis, d.top_axis
     FROM templates t
     LEFT JOIN templates_details d
       ON d.id = (SELECT id FROM templates_details WHERE templateid = t.id ORDER BY id DESC LIMIT 1)
     WHERE t.id = ? AND t.status = 1`,
    [templateId]
  );
  if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const [[emp]] = await pool.execute<RowDataPacket[]>(
    'SELECT first_name, last_name, profile_pic FROM emp_details WHERE emp_pkey = ?',
    [empFkey]
  );
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const mergeTokens = await buildMergeTokens(pool, empFkey);
  const tokens: Record<string, string> = {
    ...mergeTokens,
    first_name: emp.first_name ?? '',
    last_name: emp.last_name ?? '',
  };

  const resolvedText = resolveTemplateText(tpl.text_content ?? '', tokens);
  const photoUrl = emp.profile_pic ?? '';
  const geometry = {
    image: tpl.image ?? null,
    imageLeft: Number(tpl.imageLeft ?? 0),
    imageTop: Number(tpl.imageTop ?? 0),
    imagesize: Number(tpl.imagesize ?? 0),
    imageHeight: Number(tpl.imageHeight ?? 0),
    left_axis: Number(tpl.left_axis ?? 0),
    top_axis: Number(tpl.top_axis ?? 0),
  };

  return NextResponse.json({
    template: { id: tpl.id, name: tpl.name, type: tpl.type },
    geometry,
    resolvedText,
    photoUrl,
    html: buildTemplateHtml(geometry, resolvedText, photoUrl),
  });
}
