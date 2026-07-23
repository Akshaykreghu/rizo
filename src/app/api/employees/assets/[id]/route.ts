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

  const [[allocation]] = await pool.execute<RowDataPacket[]>(
    'SELECT asset FROM asset_allocate WHERE allocate_pkey = ?',
    [id]
  );
  if (!allocation) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(
      `UPDATE asset_allocate
       SET status = 'Returned', retreived_date = CURDATE(), damaged_amout = ?, retrieved_damage = ?
       WHERE allocate_pkey = ?`,
      [body.damaged_amout ?? '', body.retrieved_damage ?? 'N', id]
    );
    await connection.execute(
      `UPDATE asset_management SET status = 'Returned' WHERE asset_pkey = ?`,
      [allocation.asset]
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
