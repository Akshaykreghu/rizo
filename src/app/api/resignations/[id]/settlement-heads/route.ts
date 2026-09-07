import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports legacy save_heads() (the non-KWMT/GRTL path only — the KWMT ID Card / Notice Pay /
// "Amount paid by the employee" / Other rows are out of scope). approves.ctp's editable "OTHERS"
// block submits one changed amount per emp_settle_slip row; legacy runs:
//   ADDITION rows  (head_vals[])  → UPDATE emp_settle_slip SET salary_amount = <val>,      approved = 'Y'
//   DEDUCTION rows (head_vals2[]) → UPDATE emp_settle_slip SET salary_amount = 0 - ABS(val), approved = 'Y'
// scoped to status = 'Y'. Only rows belonging to this resignation's employee are touched.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);

  const [[req]] = await pool.execute<RowDataPacket[]>(
    'SELECT emp_fkey, Resignation_status FROM resignation_requests WHERE Resignation_pkey = ? AND status = 1',
    [id]
  );
  if (!req) return NextResponse.json({ error: 'Resignation request not found' }, { status: 404 });
  if (req.Resignation_status === 'Completed') {
    return NextResponse.json({ error: 'This resignation is already finalized' }, { status: 409 });
  }
  const empFkey = req.emp_fkey;

  const additions: Array<{ pkey: number; amount: number }> = Array.isArray(body.additions) ? body.additions : [];
  const deductions: Array<{ pkey: number; amount: number }> = Array.isArray(body.deductions) ? body.deductions : [];

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const row of additions) {
      await connection.execute(
        "UPDATE emp_settle_slip SET salary_amount = ?, approved = 'Y' WHERE emp_settle_slip_pkey = ? AND emp_fkey = ? AND status = 'Y'",
        [Number(row.amount) || 0, row.pkey, empFkey]
      );
    }
    for (const row of deductions) {
      await connection.execute(
        "UPDATE emp_settle_slip SET salary_amount = ?, approved = 'Y' WHERE emp_settle_slip_pkey = ? AND emp_fkey = ? AND status = 'Y'",
        [0 - Math.abs(Number(row.amount) || 0), row.pkey, empFkey]
      );
    }

    await connection.commit();
    return NextResponse.json({ success: true });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
