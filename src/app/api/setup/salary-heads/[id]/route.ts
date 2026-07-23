import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

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
    `UPDATE salary_heads SET head_desc = ?, head_operator = ?, head_occurance = ?, salary_head_order1 = ?
     WHERE head_pkey = ?`,
    [body.head_desc, body.head_operator ?? '', body.head_occurance ?? '', Number(body.salary_head_order1) || 0, id]
  );
  return NextResponse.json({ success: true });
}

// Head-level soft delete only — matches legacy's DeleteHead() exactly: it does not cascade
// to child salary_head_items.status, confirmed against source. Items under a deactivated
// head stay individually toggleable and are excluded from the Structure builder only via
// the explicit head-status join, not by this call.
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

  await pool.execute('UPDATE salary_heads SET status = 0 WHERE head_pkey = ?', [id]);
  return NextResponse.json({ success: true });
}
