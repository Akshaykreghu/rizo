import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, rowId } = await params;
  // Employees can remove their own family members (matches GET /api/employees/[id]/family).
  if (session.user.userGroup !== 1 && session.user.empFkey !== parseInt(id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  // Soft delete (status=0): emp_family is the permanent, post-onboarding record, unlike the
  // staging `family` table (Join flow) which is hard-deleted on discard.
  await pool.execute(
    'UPDATE emp_family SET status = 0 WHERE emp_family_pkey = ? AND emp_fkey = ?',
    [rowId, id]
  );

  return NextResponse.json({ success: true });
}
