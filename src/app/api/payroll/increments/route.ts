import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { createIncrementDraft } from '@/lib/increments';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const status = request.nextUrl.searchParams.get('status') ?? 'pending';
  const actionClause = status === 'processed' ? `sh.action = 'Processed'` : `sh.action IS NULL`;

  const pool = await getCompanyPool(session.user.companyCode);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT sh.salary_hike_pkey, sh.structure_change, sh.remarks, sh.action, sh.creation_date,
            shd.emp_fkey, CONCAT(COALESCE(ed.first_name,''),' ',COALESCE(ed.last_name,'')) AS emp_name,
            shd.with_effect_from, shd.payout_month, shd.current_amount, shd.new_amount,
            shd.increment_amount, shd.increment_percentage, shd.arrear_salary, shd.processed
     FROM salary_hike sh
     JOIN salary_hike_details shd ON shd.salary_hike_fkey = sh.salary_hike_pkey AND shd.status = 1
     JOIN emp_details ed ON ed.emp_pkey = shd.emp_fkey
     WHERE sh.status = 1 AND sh.is_multiple = 'N' AND sh.item = 'N' AND ${actionClause}
     ORDER BY sh.creation_date DESC`
  );
  return NextResponse.json({ rows });
}

// Mirrors SalaryIncrementController::saveIncrement() (gross-level, single-employee).
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as {
    empFkey: number; structureId: number; newGross: number; withEffectFrom: string;
    nextIncrementDate: string; payoutMonth?: string; remarks?: string;
  };
  if (!body.empFkey || !body.structureId || !body.newGross || !body.withEffectFrom || !body.nextIncrementDate) {
    return NextResponse.json({ error: 'empFkey, structureId, newGross, withEffectFrom, nextIncrementDate are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const { hikeId } = await createIncrementDraft(pool, body, session.user.loginUserId);
  return NextResponse.json({ id: hikeId }, { status: 201 });
}
