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
    'SELECT id, branch_name, branch_code, address, city, state, pincode, status FROM branches WHERE status = 1 ORDER BY branch_name'
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

  // branch_code is deliberately not accepted from the client: a live BEFORE INSERT trigger
  // (`branches_bi`) always overwrites it with a system-generated `<company_code><n>` value,
  // matching legacy's own behavior (BranchController::savebranch() never lets the form set it).
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO branches
       (company_code, branch_name, branch_code, address, city, state, pincode, latitude, longitude, status)
     VALUES (?, ?, '', ?, ?, ?, ?, 0, 0, 1)`,
    [
      session.user.companyCode,
      body.branch_name,
      body.address ?? '',
      body.city ?? '',
      body.state ?? '',
      body.pincode ?? '',
    ]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
