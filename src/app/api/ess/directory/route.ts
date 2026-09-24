import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Company-directory search for "Find Employee" on My Team. Deliberately separate from
// GET /api/employees, which restricts userGroup 2 sessions to their own record only (that
// route backs the admin employee-management grid, not a directory lookup) — this route
// returns only directory-safe fields (no DOB, no status, no admin-management data) and is
// open to any authenticated session, matching /api/setup/branches / /api/company.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const search = request.nextUrl.searchParams.get('search')?.trim() ?? '';
  if (!search) return NextResponse.json([]);

  const pool = await getCompanyPool(session.user.companyCode);
  const like = `%${search}%`;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT e.emp_pkey, e.first_name, e.last_name, e.mobile_no, e.email,
            COALESCE(NULLIF(TRIM(p.emp_company_id), ''), e.emp_id) AS emp_code, e.profile_pic,
            ds.desig_name, d.dept_name, b.branch_name
     FROM emp_details e
     LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
     LEFT JOIN branches b ON b.branch_code = p.emp_branch
     LEFT JOIN department d ON d.dept_code = p.emp_dept
     LEFT JOIN designation ds ON ds.desig_code = p.designation
     WHERE e.status = 1 AND (e.first_name LIKE ? OR e.last_name LIKE ? OR e.emp_id LIKE ? OR p.emp_company_id LIKE ?)
     ORDER BY e.first_name
     LIMIT 20`,
    [like, like, like, like]
  );
  return NextResponse.json(rows);
}
