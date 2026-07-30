import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports deleteEmployee() — soft-remove, blocked once already Approved (matches every other
// request/approve flow's convention of locking a record after it's actually settled).
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

  const [[entry]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_expenses_pkey, expense_status FROM emp_expense WHERE emp_expenses_pkey = ? AND status != 0',
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (entry.expense_status === 'Approved') {
    return NextResponse.json({ error: 'Cannot remove an already-approved claim' }, { status: 409 });
  }

  await pool.execute(
    `UPDATE emp_expense SET status = 0, expense_status = 'Removed' WHERE emp_expenses_pkey = ?`,
    [id]
  );
  return NextResponse.json({ success: true });
}
