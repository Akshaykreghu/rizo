import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { monthYearToEvuFormat } from '@/lib/payroll';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Legacy's special-companies list (PayrollController::removePayrollEntry) — GRTL is not in it.
const SPECIAL_COMPANIES = [
  'HRBL', 'KWMT', 'AIMA', 'ESNP', 'MBCT', 'MRBS', 'STCL', 'VGNN', 'ABSG', 'VGFS', 'VSFS',
  'DRRC', 'DJIC', 'AGNG', 'AYRK', 'SRTS', 'SHYD', 'GTRA',
];

// Mirrors PayrollController::removePayrollEntry() exactly, including its lack of a state guard —
// this can reset an already-Approved row back to draft without undoing the advance/loan settlement
// payroll_master_approve already committed. Confirmed as a real legacy gap (not a deliberate
// reversal feature); ported as-is per explicit product decision to match legacy behavior.
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

  await pool.query(`UPDATE payroll_master SET action = NULL WHERE payroll_master_pkey IN (${placeholders})`, body.ids);

  await pool.query(
    `UPDATE emp_salary_slip SET end_date_effective = CURDATE(), modified_by = ?
     WHERE payroll_master_fkey IN (${placeholders}) AND end_date_effective IS NULL`,
    [session.user.loginUserId, ...body.ids]
  );

  const companyCode = session.user.companyCode.toUpperCase();
  if (!SPECIAL_COMPANIES.includes(companyCode)) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT DISTINCT emp_fkey, month_year FROM payroll_master WHERE payroll_master_pkey IN (${placeholders})`,
      body.ids
    );
    for (const row of rows) {
      await pool.execute(
        `UPDATE emp_variables_upload SET status = 0
         WHERE emp_fkey = ? AND month_year = ? AND status = 1 AND LOWER(head_type) = 'fixed'`,
        [row.emp_fkey, monthYearToEvuFormat(row.month_year)]
      );
    }
  }

  return NextResponse.json({ success: true });
}
