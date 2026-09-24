import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Employee self-service asset requests. Independent of asset_management/asset_allocate (the
// admin-owned catalog + real allocation records) — a request only ever writes emp_asset_request;
// approving one (see [id]/decide/route.ts) is a status change only, not an allocation.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const employee = session.user.userGroup === 1 ? (searchParams.get('employee') ?? '') : String(session.user.empFkey);
  const status = searchParams.get('status') ?? '';

  const pool = await getCompanyPool(session.user.companyCode);
  const conditions: string[] = ['r.active = 1'];
  const values: (string | number)[] = [];
  if (employee) { conditions.push('r.emp_fkey = ?'); values.push(Number(employee)); }
  if (status) { conditions.push('r.status = ?'); values.push(status); }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT r.request_pkey, r.emp_fkey, r.asset_type_fkey, r.asset_pkey, r.asset_name, r.reason, r.status,
            r.remarks, r.decided_by, r.decided_date, r.created_date,
            ed.first_name, ed.last_name, ed.emp_id,
            at.asset_type_name, m.status AS live_asset_status
     FROM emp_asset_request r
     JOIN emp_details ed ON ed.emp_pkey = r.emp_fkey
     LEFT JOIN asset_types at ON at.asset_type_pkey = r.asset_type_fkey
     LEFT JOIN asset_management m ON m.asset_pkey = r.asset_pkey
     WHERE ${conditions.join(' AND ')}
     ORDER BY r.request_pkey DESC
     LIMIT 200`,
    values
  );
  return NextResponse.json({ data: rows });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.userGroup !== 1 && !session.user.empFkey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { assetTypeFkey, assetPkey, assetName, reason } = body as {
    empFkey?: number; assetTypeFkey?: number | null; assetPkey?: number | null; assetName: string; reason?: string;
  };
  // Employee self-service can only ever request for themselves.
  const empFkey = session.user.userGroup === 1 ? body.empFkey : session.user.empFkey;

  if (!empFkey || !assetName) {
    return NextResponse.json({ error: 'empFkey and assetName are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO emp_asset_request
       (emp_fkey, asset_type_fkey, asset_pkey, asset_name, reason, status, created_by, created_date, active)
     VALUES (?, ?, ?, ?, ?, 'Pending', ?, NOW(), 1)`,
    [empFkey, assetTypeFkey ?? null, assetPkey ?? null, assetName, reason ?? null, session.user.loginUserId]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
