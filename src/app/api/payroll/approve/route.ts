import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { approvePayrollEmployee } from '@/lib/payroll';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors PayrollController::approvepayroll(): calls payroll_master_approve per row (settles
// pending advance/loan EMI rows), then sets action='Approved' — the proc itself does not set it.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as { ids: number[] };
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: 'ids is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const placeholders = body.ids.map(() => '?').join(',');

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT payroll_master_pkey, branch_code, month_year, emp_fkey FROM payroll_master
     WHERE payroll_master_pkey IN (${placeholders})`,
    body.ids
  );

  const errors: { payroll_master_pkey: number; error: string }[] = [];
  for (const row of rows) {
    const err = await approvePayrollEmployee(
      pool, row.branch_code, row.month_year, row.emp_fkey, session.user.loginUserId
    );
    if (err) errors.push({ payroll_master_pkey: row.payroll_master_pkey, error: err });
  }

  await pool.query(`UPDATE payroll_master SET action = 'Approved' WHERE payroll_master_pkey IN (${placeholders})`, body.ids);

  return NextResponse.json({ success: true, approved: rows.length, errors });
}
