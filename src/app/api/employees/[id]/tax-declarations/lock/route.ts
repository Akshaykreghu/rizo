import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

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
  const { fin_year, locked } = body as { fin_year: number; locked: boolean };
  const lockedValue = locked ? 'Y' : 'N';
  const pool = await getCompanyPool(session.user.companyCode);

  if (body.lockAll) {
    await pool.execute(
      `UPDATE emp_tax_transactions SET locked = ?, modified_by = ? WHERE emp_fkey = ? AND fin_year = ?`,
      [lockedValue, session.user.loginUserId, id, fin_year]
    );
    return NextResponse.json({ success: true });
  }

  const { tax_heads_fkey, tax_heads_details_fkey } = body as { tax_heads_fkey: number; tax_heads_details_fkey: number };
  await pool.execute(
    `UPDATE emp_tax_transactions SET locked = ?, modified_by = ?
     WHERE emp_fkey = ? AND tax_heads_fkey = ? AND tax_heads_details_fkey = ? AND fin_year = ?`,
    [lockedValue, session.user.loginUserId, id, tax_heads_fkey, tax_heads_details_fkey, fin_year]
  );
  return NextResponse.json({ success: true });
}
