import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT asset_pkey, name, Type, specifications, serial_no, model, brand, warranty, value, year, status
     FROM asset_management WHERE active = '1' ORDER BY name`
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO asset_management
       (emp_fkey, name, specifications, Type, serial_no, warranty, model, brand, value, year, status, active)
     VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Not Allocated', '1')`,
    [
      body.name, body.specifications ?? null, body.Type ?? null, body.serial_no ?? null,
      body.warranty ?? null, body.model ?? null, body.brand ?? null, body.value ?? null, body.year ?? null,
    ]
  );
  return NextResponse.json({ asset_pkey: result.insertId }, { status: 201 });
}
