import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

// Mirrors legacy withd(): cancel a resignation before final removal, cascading to the
// termination and resignation_accept rows.

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(
      "UPDATE resignation_requests SET Resignation_status = 'Cancelled', status = 0 WHERE Resignation_pkey = ?",
      [id]
    );
    await connection.execute(
      "UPDATE termination SET status = 0, remarks = 'Employee cancelled' WHERE Resignation_pkey = ? AND status = 1",
      [id]
    );
    await connection.execute(
      'UPDATE resignation_accept SET status = 0 WHERE Resignation_pkey = ? AND status = 1',
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
