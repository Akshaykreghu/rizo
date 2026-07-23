import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

interface DuplicateError {
  code?: string;
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
  const finYear = new Date(body.start_month).getFullYear();

  try {
    await pool.execute(
      `UPDATE fin_year SET
         branch_code = ?, fin_year = ?, start_month = ?, end_month = ?,
         Year_status = ?, is_current_finyear = ?, vattr1 = ?
       WHERE Fin_year_seq = ?`,
      [
        body.branch_code,
        finYear,
        body.start_month,
        body.end_month,
        body.Year_status ?? 'OPEN',
        body.is_current_finyear === 'Y' ? 'Y' : 'N',
        Number(body.vattr1) || 0,
        id,
      ]
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    if ((err as DuplicateError).code === 'ER_DUP_ENTRY') {
      return NextResponse.json(
        { error: 'A financial year already exists for this branch/status/type.' },
        { status: 409 }
      );
    }
    throw err;
  }
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

  await pool.execute('UPDATE fin_year SET status = 0 WHERE Fin_year_seq = ?', [id]);
  return NextResponse.json({ success: true });
}
