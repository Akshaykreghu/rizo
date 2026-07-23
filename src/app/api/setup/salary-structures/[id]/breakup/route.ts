import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Wraps the real, confirmed-live calculate_emp_salary_breakup(Pemp_fkey, Pstructure_id,
// Pmonthly_gross) procedure — read-only preview (writes to a session-scoped TEMPORARY table
// internally, nothing persisted). Pemp_fkey is declared by the proc but never actually
// referenced in its body (confirmed via SHOW CREATE PROCEDURE), so 0 is passed for a
// structure-level preview not tied to a specific employee.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const gross = Number(searchParams.get('gross'));
  if (!gross || gross <= 0) {
    return NextResponse.json({ error: 'A positive gross amount is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const results = await pool.query<RowDataPacket[][]>(
    'CALL calculate_emp_salary_breakup(?, ?, ?)',
    [0, id, gross]
  );
  const rows = results[0][0] as unknown as RowDataPacket[];

  return NextResponse.json({ data: rows });
}
