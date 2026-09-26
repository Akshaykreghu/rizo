import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { markAdvanceRequestDeletedByAdvanceId } from '@/lib/advances';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors EmployeeadvanceController::deleteEmployee() — soft-delete only. Legacy's own action has
// no ownership check at all (any caller could delete any id; only the admin grid's own row
// selection kept it scoped in practice) — same gap as the other self-service delete/cancel routes
// in this codebase (leave cancellation, expense remove), so this adds the same self-access
// carve-out: the request's own owner may withdraw it, not just admin. Unlike legacy, blocks
// deleting an advance that's already been credited (is_credited='Y') — once payroll has actually
// paid it out, silently deleting the record would erase that trail with no reversal.
//
// Also flips any emp_advance_request that produced this advance from Approved -> Deleted, so a
// request doesn't keep showing "Approved" for an advance that no longer exists (visible to both
// admin and the employee's own My Request view). A no-op for advances created directly via "New
// Advance".
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[entry]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_advance_pkey, emp_fkey, is_credited FROM emp_advance WHERE emp_advance_pkey = ? AND status = 1',
    [id]
  );
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (session.user.userGroup !== 1 && session.user.empFkey !== entry.emp_fkey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (entry.is_credited === 'Y') {
    return NextResponse.json({ error: 'Cannot withdraw an advance that has already been credited' }, { status: 409 });
  }

  await pool.execute('UPDATE emp_advance SET status = 0 WHERE emp_advance_pkey = ?', [id]);
  await markAdvanceRequestDeletedByAdvanceId(pool, Number(id), session.user.loginUserId);
  return NextResponse.json({ success: true });
}
