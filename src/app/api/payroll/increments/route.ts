import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { createIncrementDraft, createItemIncrementDraft } from '@/lib/increments';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const status = request.nextUrl.searchParams.get('status') ?? 'pending';
  // Legacy "Not Processed" = action IS NULL OR action <> 'Processed' (a row left in some other
  // interim action state still belongs in the pending list, not hidden from both tabs).
  const actionClause = status === 'processed' ? `sh.action = 'Processed'` : `(sh.action IS NULL OR sh.action <> 'Processed')`;

  const pool = await getCompanyPool(session.user.companyCode);
  // One row per hike. Gross hikes have a single detail row (SUM == the value); item hikes have
  // one per component (SUM across components ~= net change), with component_count for the label.
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT sh.salary_hike_pkey, sh.structure_change, sh.remarks, sh.action, sh.creation_date, sh.item,
            MAX(shd.emp_fkey) AS emp_fkey,
            MAX(TRIM(CONCAT(COALESCE(ed.first_name,''),' ',COALESCE(ed.last_name,'')))) AS emp_name,
            MAX(shd.with_effect_from) AS with_effect_from,
            MAX(shd.payout_month) AS payout_month,
            SUM(shd.current_amount) AS current_amount,
            SUM(shd.new_amount) AS new_amount,
            SUM(shd.increment_amount) AS increment_amount,
            CASE WHEN SUM(shd.current_amount) > 0
                 THEN (SUM(shd.increment_amount) / SUM(shd.current_amount)) * 100 ELSE 0 END AS increment_percentage,
            MAX(shd.arrear_salary) AS arrear_salary,
            MIN(shd.processed) AS processed,
            COUNT(*) AS component_count
     FROM salary_hike sh
     JOIN salary_hike_details shd ON shd.salary_hike_fkey = sh.salary_hike_pkey AND shd.status = 1
     JOIN emp_details ed ON ed.emp_pkey = shd.emp_fkey
     WHERE sh.status = 1 AND sh.is_multiple = 'N' AND ${actionClause}
     GROUP BY sh.salary_hike_pkey
     ORDER BY sh.creation_date DESC`
  );
  return NextResponse.json({ rows });
}

// Mirrors SalaryIncrementController::saveIncrement() — gross branch (no components[]) or
// item branch (one salary_hike_details row per component).
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as {
    empFkey: number; structureId: number; newGross?: number; withEffectFrom: string;
    nextIncrementDate: string; payoutMonth?: string; remarks?: string;
    components?: { salaryHeadItemFkey: number; currentAmount: number; newAmount: number }[];
  };

  if (!body.empFkey || !body.structureId || !body.withEffectFrom || !body.nextIncrementDate) {
    return NextResponse.json({ error: 'empFkey, structureId, withEffectFrom, nextIncrementDate are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  if (Array.isArray(body.components) && body.components.length > 0) {
    const { hikeId } = await createItemIncrementDraft(
      pool,
      {
        empFkey: body.empFkey, structureId: body.structureId, withEffectFrom: body.withEffectFrom,
        nextIncrementDate: body.nextIncrementDate, payoutMonth: body.payoutMonth, remarks: body.remarks,
        components: body.components,
      },
      session.user.loginUserId
    );
    return NextResponse.json({ id: hikeId }, { status: 201 });
  }

  if (!body.newGross) {
    return NextResponse.json({ error: 'newGross is required for a gross-level increment' }, { status: 400 });
  }
  const { hikeId } = await createIncrementDraft(
    pool,
    { ...body, newGross: body.newGross },
    session.user.loginUserId
  );
  return NextResponse.json({ id: hikeId }, { status: 201 });
}
