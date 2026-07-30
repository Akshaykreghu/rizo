import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

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

  const [[entry]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_expenses_pkey, expense_status FROM emp_expense WHERE emp_expenses_pkey = ? AND status != 0',
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (entry.expense_status === 'Approved' || entry.expense_status === 'Rejected') {
    return NextResponse.json({ error: `Cannot reject a claim in status '${entry.expense_status}'` }, { status: 409 });
  }

  await pool.execute(
    `UPDATE emp_expense SET expense_status = 'Rejected', status = 2, remarks_approved = ? WHERE emp_expenses_pkey = ?`,
    [body.remarks ?? null, id]
  );
  return NextResponse.json({ success: true });
}
