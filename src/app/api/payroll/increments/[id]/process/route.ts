import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { processIncrement, processItemIncrement, alterSalaryStructure } from '@/lib/increments';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors the view.ctp "Process" button. When salary_hike.structure_change = 'Y' the legacy
// button first calls alterSalaryStructure (move the employee onto the drafted structure, run the
// statutory / salary gates) and then process / processItem — so do the same here. process() /
// processItem()'s own structure_change guard then passes for the aligned employees and skips the
// ones alterSalaryStructure blocked.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const [[hike]] = await pool.execute<RowDataPacket[]>(
    'SELECT item, structure_change FROM salary_hike WHERE salary_hike_pkey = ?',
    [Number(id)]
  );

  const structureResult = hike?.structure_change === 'Y'
    ? await alterSalaryStructure(pool, Number(id), session.user.loginUserId, session.user.companyCode)
    : undefined;

  const result = hike?.item === 'Y'
    ? await processItemIncrement(pool, Number(id), session.user.loginUserId)
    : await processIncrement(pool, Number(id), session.user.loginUserId);

  return NextResponse.json({ ...result, structureResult });
}
