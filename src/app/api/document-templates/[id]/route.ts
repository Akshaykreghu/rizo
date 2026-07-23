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
    'SELECT template_pkey, template_name, template_content, availability FROM doc_template WHERE template_pkey = ? AND status = 1',
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

  await pool.execute(
    `UPDATE doc_template SET template_name = ?, template_content = ?, availability = ?, modified_by = ?, modification_date = NOW()
     WHERE template_pkey = ?`,
    [body.template_name, body.template_content, body.availability ?? '1', session.user.loginUserId, id]
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
  await pool.execute('UPDATE doc_template SET status = 0 WHERE template_pkey = ?', [id]);
  return NextResponse.json({ success: true });
}
