import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports OtAttendanceNewController::approves(): upserts emp_ot_master.set_duration, flips
// is_verified='Y', then CALLs calculate_ot_allowance_prc (confirmed live signature:
// pemp_pkey int, pmonth_year varchar(7), pcreated_by varchar(30)) to push the approved OT into the
// salary/allowance calculation.

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const month: string = body.month;
  const employees: { emp_fkey: number; set_duration_min?: number }[] = body.employees ?? [];
  if (!month || employees.length === 0) {
    return NextResponse.json({ error: 'month and employees are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);
  const userId = session.user.loginUserId ?? String(session.user.empFkey ?? 'system');
  const monthDate = `${month}-01`;

  for (const emp of employees) {
    const [[existing]] = await pool.execute<RowDataPacket[]>(
      `SELECT emp_ot_master_pkey, total_duration FROM emp_ot_master WHERE emp_fkey = ? AND DATE_FORMAT(month, '%Y-%m') = ?`,
      [emp.emp_fkey, month]
    );

    if (existing) {
      const setDuration = emp.set_duration_min ?? existing.total_duration ?? 0;
      await pool.execute(
        `UPDATE emp_ot_master SET set_duration = ?, is_verified = 'Y' WHERE emp_ot_master_pkey = ?`,
        [setDuration, existing.emp_ot_master_pkey]
      );
    } else {
      await pool.execute(
        `INSERT INTO emp_ot_master (emp_fkey, emp_name, month, total_duration, set_duration, is_verified)
         SELECT ?, CONCAT(first_name, ' ', IFNULL(last_name, '')), ?, 0, ?, 'Y' FROM emp_details WHERE emp_pkey = ?`,
        [emp.emp_fkey, monthDate, emp.set_duration_min ?? 0, emp.emp_fkey]
      );
    }

    await pool.query('CALL calculate_ot_allowance_prc(?, ?, ?)', [emp.emp_fkey, month, userId]);
  }

  return NextResponse.json({ success: true });
}
