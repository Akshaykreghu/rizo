import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

// Mirrors legacy grandrequest(): the HR/manager handover checklist, separate from the
// employee-submitted request and from final admin approval. Also flips termination.is_authorized
// to 'Y' — this app collapses legacy's separate authorise-vs-accept sub-steps into one checklist
// action for simplicity.

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
  const pool = await getCompanyPool(session.user.companyCode);
  const today = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const [[req]] = (await pool.execute('SELECT emp_fkey FROM resignation_requests WHERE Resignation_pkey = ? AND status = 1', [id])) as unknown as [{ emp_fkey: number }[]];
  if (!req) return NextResponse.json({ error: 'Resignation request not found' }, { status: 404 });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(
      `INSERT INTO resignation_accept
         (applied_emp, Resignation_pkey, last_allowed_date, comments_to_emp, comments_to_hr,
          manager_reason, forwarded, isauthorized, authorized_date, isApproved, approved_date,
          handover_to, hr_comment, chek_formalities, chek_assets, chek_leave, status)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, 0, ?, ?, ?, ?, ?, ?, 1)`,
      [
        req.emp_fkey, id, body.last_allowed_date ?? null, body.comments_to_emp ?? '', body.comments_to_hr ?? '',
        body.manager_reason ?? '', today, today, body.handover_to, body.hr_comment ?? '',
        body.chek_formalities ? 1 : 0, body.chek_assets ? 1 : 0, body.chek_leave ? 1 : 0,
      ]
    );

    await connection.execute(
      "UPDATE termination SET is_authorized = 'Y', authorized_by = ? WHERE Resignation_pkey = ? AND status = 1",
      [Number(session.user.empFkey) || 0, id]
    );
    await connection.execute(
      "UPDATE resignation_requests SET Resignation_status = 'HR Reviewed' WHERE Resignation_pkey = ?",
      [id]
    );

    await connection.commit();
    return NextResponse.json({ success: true });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
