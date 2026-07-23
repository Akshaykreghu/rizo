import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, docId } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  // Soft delete (status=0): emp_passport_visa is the permanent, post-onboarding record,
  // unlike the staging emp_documents table which is hard-deleted on discard.
  await pool.execute(
    'UPDATE emp_passport_visa SET status = 0 WHERE emp_passport_visa_pkey = ? AND emp_fkey = ?',
    [docId, id]
  );

  return NextResponse.json({ success: true });
}
