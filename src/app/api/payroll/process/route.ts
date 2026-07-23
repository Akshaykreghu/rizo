import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { processPayrollEmployee } from '@/lib/payroll';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors PayrollController::processpayroll(). Legacy trusts client-supplied parallel emp_pkey/
// payroll_pkey arrays matched by index; here we resolve emp_fkey/branch/month server-side from the
// payroll_master row instead (safer, same net effect) rather than trust client-supplied emp ids.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as { ids: number[]; tax: boolean };
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: 'ids is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  await pool.query(
    `UPDATE payroll_master SET tax_include = ? WHERE payroll_master_pkey IN (${body.ids.map(() => '?').join(',')})`,
    [body.tax ? 'Y' : 'N', ...body.ids]
  );

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT payroll_master_pkey, emp_fkey, branch_code, month_year FROM payroll_master
     WHERE payroll_master_pkey IN (${body.ids.map(() => '?').join(',')})`,
    body.ids
  );

  const errors: { payroll_master_pkey: number; error: string }[] = [];
  for (const row of rows) {
    const err = await processPayrollEmployee(
      pool, row.month_year, row.branch_code, row.emp_fkey, row.payroll_master_pkey, session.user.loginUserId
    );
    if (err) errors.push({ payroll_master_pkey: row.payroll_master_pkey, error: err });
  }

  return NextResponse.json({ success: true, processed: rows.length - errors.length, errors });
}
