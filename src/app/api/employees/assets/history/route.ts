import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Per-asset allocation history — mirrors legacy AssetController::details(): every allocation
// row ever recorded against one catalog asset, newest first. Read-only.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const asset = searchParams.get('asset');
  if (!asset) return NextResponse.json({ error: 'asset is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT a.allocate_pkey, a.emp_fkey, e.first_name, e.last_name, e.emp_id,
            COALESCE(NULLIF(a.asset_name, ''), m.name) AS asset_name,
            a.allocated_date, a.retreived_date, a.status, a.asset_state,
            a.damaged_amout, a.description
     FROM asset_allocate a
     LEFT JOIN emp_details e ON e.emp_pkey = a.emp_fkey
     LEFT JOIN asset_management m ON m.asset_pkey = a.asset
     WHERE a.active = '1' AND a.asset = ?
     ORDER BY a.allocated_date DESC, a.allocate_pkey DESC`,
    [asset]
  );

  return NextResponse.json({ data: rows });
}
