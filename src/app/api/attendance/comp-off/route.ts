import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { FIELD_COLUMNS } from '@/lib/attendance';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Ports CompoffController::index() — a pure read-only report (legacy has no comp-off request/
// approval table at all). Admin can view any employee (legacy hardcoded this to the logged-in
// user's own emp_fkey — this port generalizes that to an employee picker, matching every other
// admin screen in this app, rather than replicating the self-service-only scope). The
// earned-minus-used arithmetic was done in legacy's view template; moved server-side here.

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const empFkey = searchParams.get('empFkey');
  if (!empFkey) return NextResponse.json({ error: 'empFkey is required' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);

  const [[emp]] = await pool.execute<RowDataPacket[]>(
    `SELECT ed.first_name, ed.last_name, ed.emp_id, ep.designation, ep.emp_dept, ed.branch_code, b.branch_name, ep.joining_date
     FROM emp_details ed
     LEFT JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
     LEFT JOIN branches b ON b.branch_code = ed.branch_code
     WHERE ed.emp_pkey = ?`,
    [empFkey]
  );
  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const [[finYear]] = await pool.execute<RowDataPacket[]>(
    `SELECT start_month, end_month FROM fin_year WHERE branch_code = ? AND Year_status = 'OPEN' AND status = 1
     ORDER BY Fin_year_seq DESC LIMIT 1`,
    [emp.branch_code]
  );
  if (!finYear) return NextResponse.json({ error: 'No open financial year found for this branch' }, { status: 404 });

  const coffCondition = FIELD_COLUMNS.map((c) => `${c} = 'COFF'`).join(' OR ');
  const [usedRows] = await pool.execute<RowDataPacket[]>(
    `SELECT month_year, COUNT(*) AS used
     FROM attendance_register
     WHERE emp_fkey = ? AND isdelete = 'N' AND (${coffCondition})
       AND CONCAT(month_year, '-01') BETWEEN ? AND ?
     GROUP BY month_year ORDER BY month_year`,
    [empFkey, finYear.start_month, finYear.end_month]
  );

  const [earnedFull] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(yearmonth, '%Y-%m') AS month_year, COUNT(*) AS earned
     FROM emp_detail_timeattandance
     WHERE emp_pkey = ? AND (weekoff IS NOT NULL OR holiday IS NOT NULL) AND present = 'P/P'
       AND yearmonth BETWEEN ? AND ?
     GROUP BY month_year`,
    [empFkey, finYear.start_month, finYear.end_month]
  );
  const [earnedHalf] = await pool.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(yearmonth, '%Y-%m') AS month_year, COUNT(*) * 0.5 AS earned
     FROM emp_detail_timeattandance
     WHERE emp_pkey = ? AND (weekoff IS NOT NULL OR holiday IS NOT NULL) AND present IN ('P/A', 'A/P')
       AND yearmonth BETWEEN ? AND ?
     GROUP BY month_year`,
    [empFkey, finYear.start_month, finYear.end_month]
  );

  const earnedByMonth = new Map<string, number>();
  for (const r of [...earnedFull, ...earnedHalf]) {
    earnedByMonth.set(r.month_year, (earnedByMonth.get(r.month_year) ?? 0) + Number(r.earned));
  }
  const earned = Array.from(earnedByMonth.entries())
    .map(([month_year, days]) => ({ month_year, days }))
    .sort((a, b) => a.month_year.localeCompare(b.month_year));

  const used = usedRows.map((r) => ({ month_year: r.month_year, days: Number(r.used) }));
  const totalEarned = earned.reduce((sum, r) => sum + r.days, 0);
  const totalUsed = used.reduce((sum, r) => sum + r.days, 0);

  return NextResponse.json({
    employee: {
      name: `${emp.first_name} ${emp.last_name ?? ''}`.trim(),
      empId: emp.emp_id,
      designation: emp.designation,
      department: emp.emp_dept,
      branch: emp.branch_name,
      joiningDate: emp.joining_date,
    },
    used,
    earned,
    totalUsed,
    totalEarned,
    balance: totalEarned - totalUsed,
  });
}
