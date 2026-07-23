import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// GET response shape (structure_id/structure_name only) is load-bearing for existing
// employee-side structure pickers (bulk-policies, join onboarding, new/edit employee,
// promotions) — kept exactly as-is. Pass ?full=1 for the Salary Structure setup list page's
// richer columns instead of adding a second endpoint.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const full = searchParams.get('full') === '1';

  const pool = await getCompanyPool(session.user.companyCode);
  if (full) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT structure_id, structure_name, structure_eg_amt, fixed_days, prorate_code,
              startdate_effective, enddate_effective, structure_active
       FROM salary_structure ORDER BY structure_name`
    );
    return NextResponse.json(rows);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT structure_id, structure_name FROM salary_structure WHERE structure_active = 1 ORDER BY structure_name'
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
    `INSERT INTO salary_structure
       (company_code, structure_name, prorate_code, prorate_desc, fixed_days, defined_structure_for,
        structure_eg_amt, structure_created_date, startdate_effective, enddate_effective, structure_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, UNIX_TIMESTAMP(), ?, ?, 1)`,
    [
      session.user.companyCode, body.structure_name, body.prorate_code ?? '', body.prorate_desc ?? '',
      Number(body.fixed_days) || 30, body.defined_structure_for ?? '', Number(body.structure_eg_amt) || 0,
      body.startdate_effective, body.enddate_effective,
    ]
  );
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
