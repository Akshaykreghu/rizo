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
    `SELECT m.asset_pkey, m.name, m.Type, t.asset_type_name AS TypeName, m.specifications, m.serial_no,
            m.model, m.brand, m.warranty, m.value, m.year, m.status,
            EXISTS(
              SELECT 1 FROM asset_allocate aa
              WHERE aa.asset = m.asset_pkey AND aa.asset_state = '3'
            ) AS not_working
     FROM asset_management m
     LEFT JOIN asset_types t ON t.asset_type_pkey = m.Type
     WHERE m.active = '1' ORDER BY m.name`
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
