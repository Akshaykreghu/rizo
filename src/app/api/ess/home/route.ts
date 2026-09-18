import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Aggregated feed for the ESS home dashboard: birthdays/anniversaries (raw list, the client
// does the same "today vs. this week" date-math New Rizo's ESSDashboard.jsx used — no year
// rollover, matches the original exactly) and new joiners (pre-filtered here to the current
// calendar month, since that's a plain WHERE clause rather than day-of-year comparison).
// Not gated to userGroup 2 — this is company-wide, non-sensitive directory-style info, same
// class of data as /api/setup/branches or /api/company which are already open to any session.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = await getCompanyPool(session.user.companyCode);

  const [[birthdays], [anniversaries], [newJoiners]] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT e.emp_pkey, e.first_name, e.last_name, e.date_of_birth, ds.desig_name, d.dept_name
       FROM emp_details e
       LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
       LEFT JOIN designation ds ON ds.desig_code = p.designation
       LEFT JOIN department d ON d.dept_code = p.emp_dept
       WHERE e.status = 1 AND e.date_of_birth IS NOT NULL`
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT e.emp_pkey, e.first_name, e.last_name, p.joining_date, ds.desig_name, d.dept_name
       FROM emp_details e
       JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
       LEFT JOIN designation ds ON ds.desig_code = p.designation
       LEFT JOIN department d ON d.dept_code = p.emp_dept
       WHERE e.status = 1 AND p.joining_date IS NOT NULL`
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT e.emp_pkey, e.first_name, e.last_name, p.joining_date, ds.desig_name
       FROM emp_details e
       JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
       LEFT JOIN designation ds ON ds.desig_code = p.designation
       WHERE e.status = 1 AND YEAR(p.joining_date) = YEAR(CURDATE()) AND MONTH(p.joining_date) = MONTH(CURDATE())
       ORDER BY p.joining_date DESC`
    ),
  ]);

  return NextResponse.json({ birthdays, anniversaries, newJoiners });
}
