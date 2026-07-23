import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { buildMergeTokens, mergeTemplate } from '@/lib/documentMerge';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const templateFkey = Number(body.template_fkey);
  const pool = await getCompanyPool(session.user.companyCode);

  const [[template]] = await pool.execute<RowDataPacket[]>(
    'SELECT template_pkey, template_name, template_content FROM doc_template WHERE template_pkey = ? AND status = 1',
    [templateFkey]
  );
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const tokens = await buildMergeTokens(pool, Number(id));
  const merged = mergeTemplate(template.template_content, tokens);
  const docId = `DOC${Date.now()}`;

  if (body.save) {
    const [[company]] = await pool.execute<RowDataPacket[]>('SELECT id FROM comp_contact_info LIMIT 1');
    const [[branchRow]] = await pool.execute<RowDataPacket[]>(
      'SELECT b.id FROM emp_proff p JOIN branches b ON b.branch_code = p.emp_branch WHERE p.emp_fkey = ?',
      [id]
    );

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO documents
         (emp_fkey, template_fkey, doc_id, company_fkey, branch_fkey, document_name, document,
          created_by, creation_date, modified_by, modification_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW(), 1)`,
      [
        id, templateFkey, docId, company?.id ?? 0, branchRow?.id ?? 0,
        `${template.template_name} - ${tokens['empolyee_name']}`, merged,
        session.user.loginUserId, session.user.loginUserId,
      ]
    );
    return NextResponse.json({ document_pkey: result.insertId, html: merged }, { status: 201 });
  }

  return NextResponse.json({ html: merged });
}
