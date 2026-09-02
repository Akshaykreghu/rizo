import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { buildMergeTokens } from '@/lib/documentMerge';
import { buildTemplateHtml, resolveTemplateText } from '@/lib/imageTemplate';
import { sendMail } from '@/lib/mailer';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports DocumentManagerController::sendemailtemplate($emp_fkey, 'birthday'): take the default
// birthday image template, merge it for this employee, and email the rendered HTML to their
// registered address. Legacy sent via PHPMailer over SMTP; here src/lib/mailer.ts does the same
// when SMTP_* env vars are set and is a logged no-op otherwise. There is no scheduler in this
// codebase (legacy's send is triggered ad hoc / by a separate cron) — this is a manual action.

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const empFkey = Number(id);
  const pool = await getCompanyPool(session.user.companyCode);

  let tpl: RowDataPacket | undefined;
  try {
    const [[row]] = await pool.execute<RowDataPacket[]>(
      `SELECT t.id, t.image, t.imageLeft, t.imageTop, t.imagesize, t.imageHeight,
              d.text_content, d.left_axis, d.top_axis
       FROM templates t
       LEFT JOIN templates_details d
         ON d.id = (SELECT id FROM templates_details WHERE templateid = t.id ORDER BY id DESC LIMIT 1)
       WHERE t.type = 'birthday' AND t.is_default = 1 AND t.status = 1
       ORDER BY t.id DESC LIMIT 1`
    );
    tpl = row;
  } catch {
    return NextResponse.json({ error: 'image_templates_unavailable' }, { status: 503 });
  }
  if (!tpl) {
    return NextResponse.json({ status: 'no-default-template' });
  }

  const [[emp]] = await pool.execute<RowDataPacket[]>(
    `SELECT e.first_name, e.last_name, e.profile_pic, uc.email
     FROM emp_details e
     LEFT JOIN user_credentials uc ON uc.emp_fkey = e.emp_pkey
     WHERE e.emp_pkey = ?`,
    [empFkey]
  );
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  if (!emp.email) return NextResponse.json({ status: 'no-email' });

  const mergeTokens = await buildMergeTokens(pool, empFkey);
  const resolvedText = resolveTemplateText(tpl.text_content ?? '', {
    ...mergeTokens,
    first_name: emp.first_name ?? '',
    last_name: emp.last_name ?? '',
  });

  const html = buildTemplateHtml(
    {
      image: tpl.image ?? null,
      imageLeft: Number(tpl.imageLeft ?? 0),
      imageTop: Number(tpl.imageTop ?? 0),
      imagesize: Number(tpl.imagesize ?? 0),
      imageHeight: Number(tpl.imageHeight ?? 0),
      left_axis: Number(tpl.left_axis ?? 0),
      top_axis: Number(tpl.top_axis ?? 0),
    },
    resolvedText,
    emp.profile_pic ?? ''
  );

  const result = await sendMail({
    to: emp.email,
    subject: 'Happy Birthday!',
    html: `<!DOCTYPE html><html><body>${html}</body></html>`,
    text: `Happy Birthday, ${emp.first_name ?? ''}!`,
  });

  return NextResponse.json({ status: result.status, to: emp.email });
}
