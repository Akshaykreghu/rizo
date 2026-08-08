import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { futureDateError } from '@/lib/validation';

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
    'SELECT asset, allocated_date FROM asset_allocate WHERE allocate_pkey = ?',
    [id]
  );
  if (!allocation) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Defensive guard for pre-existing bad data (an allocation created before ASSET-002's
  // future-date validation existed): retreived_date is always today, so returning an asset
  // allocated in the future would otherwise silently create a logically-backwards record.
  if (new Date(allocation.allocated_date) > new Date()) {
    return NextResponse.json(
      { error: 'This allocation has a future Allocated date — correct it via Edit before marking it returned.' },
      { status: 400 }
    );
  }

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

// Mirrors legacy AssetController::edit()+assetsave(): allocation records can be corrected
// in place rather than only allocated-anew or marked-returned (ASSET-003). Deliberately
// narrower than legacy's own edit form, which also lets you reassign the Employee/Asset —
// legacy's save path (Model::save() + a separate asset_management status query) never
// releases the *original* asset back to available when the asset is swapped, a real latent
// data-integrity gap in legacy itself. Not reproduced here: only the fields that don't touch
// asset<->allocation identity (date, condition, notes) are editable; correcting who/what an
// allocation is for still goes through Mark Returned + a fresh allocation, which is the only
// path in this app that reliably keeps asset_management.status in sync either way.
export async function PATCH(
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
    'SELECT retreived_date FROM asset_allocate WHERE allocate_pkey = ?',
    [id]
  );
  if (!allocation) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const dateError = futureDateError(body.allocated_date ?? '', 'Allocated date');
  if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });

  if (allocation.retreived_date && new Date(body.allocated_date) > new Date(allocation.retreived_date)) {
    return NextResponse.json({ error: 'Allocated date cannot be after the Returned date on this record.' }, { status: 400 });
  }

  await pool.execute(
    `UPDATE asset_allocate SET allocated_date = ?, asset_state = ?, description = ? WHERE allocate_pkey = ?`,
    [body.allocated_date, body.asset_state ? Number(body.asset_state) : 1, body.description ?? '', id]
  );

  return NextResponse.json({ success: true });
}
