import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; allocationId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { allocationId } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  await pool.execute(
    'UPDATE document_allocation SET status = 0, end_date_effective = NOW() WHERE document_allocation_pkey = ?',
    [allocationId]
  );
  return NextResponse.json({ success: true });
}
