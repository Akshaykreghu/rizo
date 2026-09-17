import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextResponse } from 'next/server';

// Ports deleteleave() (controller.php:726-739) — a soft delete: only flips emp_leave_upload.status
// to 0 so the row drops out of listleave()'s `status = 1` filter. Deliberately does NOT touch
// leaveentries.LEAVESTATUS, matching legacy exactly (looks like an oversight in legacy, but the
// user's "follow legacy logic" decision covers reproducing it, not fixing it).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);
  await pool.execute(
    'UPDATE emp_leave_upload SET status = 0 WHERE emp_leave_upload_pkey = ?',
    [Number(id)]
  );

  return NextResponse.json({ success: true });
}
