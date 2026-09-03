import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { futureDateError } from '@/lib/validation';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') ?? '';
  const empFkey = searchParams.get('emp_fkey');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1);
  const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') ?? '25') || 25);
  const offset = (page - 1) * pageSize;

  const conditions: string[] = ["a.active = '1'"];
  const params: string[] = [];
  if (empFkey) {
    conditions.push('a.emp_fkey = ?');
    params.push(empFkey);
  }
  if (search) {
    conditions.push('(e.first_name LIKE ? OR e.last_name LIKE ? OR e.emp_id LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const [[countRow], [rows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM asset_allocate a LEFT JOIN emp_details e ON e.emp_pkey = a.emp_fkey ${where}`,
      params
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT a.allocate_pkey, a.emp_fkey, e.first_name, e.last_name, e.emp_id,
              a.asset, COALESCE(NULLIF(a.asset_name, ''), m.name) AS asset_name,
              COALESCE(NULLIF(a.model, ''), m.model) AS model, COALESCE(NULLIF(a.brand, ''), m.brand) AS brand,
              a.s_no, a.warranty, a.allocated_date, a.retreived_date, a.status,
              a.asset_state, a.damaged_amout
       FROM asset_allocate a
       LEFT JOIN emp_details e ON e.emp_pkey = a.emp_fkey
       LEFT JOIN asset_management m ON m.asset_pkey = a.asset
       ${where}
       ORDER BY a.allocated_date DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    ),
  ]);

  return NextResponse.json({ data: rows, total: countRow[0]?.total ?? 0 });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  const dateError = futureDateError(body.allocated_date ?? '', 'Allocated date');
  if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);

  const [[asset]] = await pool.execute<RowDataPacket[]>(
    'SELECT asset_pkey, name, model, brand, serial_no, warranty, status FROM asset_management WHERE asset_pkey = ?',
    [body.asset]
  );
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  if (asset.status === 'Allocated') {
    return NextResponse.json({ error: 'This asset is already allocated to someone' }, { status: 409 });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO asset_allocate
         (emp_fkey, asset, qty, model, asset_name, brand, s_no, warranty, allocated_date,
          pemp_fkey, status, damaged_amout, description, official_mail, official_contact,
          crm_id, allocated_ofc_space, asset_state, active)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 0, 'Allocated', '', ?, '', '', '', '', ?, '1')`,
      [
        body.emp_fkey, body.asset, asset.model ?? '', asset.name, asset.brand ?? '',
        asset.serial_no ?? '', asset.warranty ?? '', body.allocated_date,
        body.description ?? '', body.asset_state ? Number(body.asset_state) : 1,
      ]
    );

    await connection.execute(
      `UPDATE asset_management SET status = 'Allocated' WHERE asset_pkey = ?`,
      [body.asset]
    );

    await connection.commit();
    return NextResponse.json({ allocate_pkey: result.insertId }, { status: 201 });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
