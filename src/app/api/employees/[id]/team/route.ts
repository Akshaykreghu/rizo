import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Reporting hierarchy for the ESS "My Team" page: manager + peers (same manager) + direct
// reports, all derived from emp_proff.attr1 — the same denormalized manager pointer
// /api/employees/hierarchy already maintains (see that route's comments). An employee with no
// manager set (~62 of 217 here, mostly historical bulk-imported rows) has no defined peer group
// either — showing everyone else with no manager as "peers" would be meaningless noise.

const PERSON_COLS = 'e.emp_pkey, e.first_name, e.last_name, e.emp_id AS emp_code, e.mobile_no, e.email, ds.desig_name, d.dept_name, b.branch_name';
const PERSON_JOIN = `
  FROM emp_details e
  LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
  LEFT JOIN branches b ON b.branch_code = p.emp_branch
  LEFT JOIN department d ON d.dept_code = p.emp_dept
  LEFT JOIN designation ds ON ds.desig_code = p.designation
`;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const empPkey = parseInt(id);
  if (session.user.userGroup !== 1 && session.user.empFkey !== empPkey) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [[selfRows], [managerAttrRows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(`SELECT ${PERSON_COLS} ${PERSON_JOIN} WHERE e.emp_pkey = ?`, [empPkey]),
    pool.execute<RowDataPacket[]>('SELECT attr1 FROM emp_proff WHERE emp_fkey = ?', [empPkey]),
  ]);

  if (!selfRows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const managerId = Number(managerAttrRows[0]?.attr1) || null;

  const [[managerRows], [directReports], [peers]] = await Promise.all([
    managerId
      ? pool.execute<RowDataPacket[]>(`SELECT ${PERSON_COLS} ${PERSON_JOIN} WHERE e.emp_pkey = ?`, [managerId])
      : Promise.resolve([[] as RowDataPacket[]]),
    pool.execute<RowDataPacket[]>(
      `SELECT ${PERSON_COLS} ${PERSON_JOIN} WHERE e.status = 1 AND p.attr1 = ? ORDER BY e.first_name`,
      [String(empPkey)]
    ),
    managerId
      ? pool.execute<RowDataPacket[]>(
          `SELECT ${PERSON_COLS} ${PERSON_JOIN} WHERE e.status = 1 AND p.attr1 = ? AND e.emp_pkey != ? ORDER BY e.first_name`,
          [String(managerId), empPkey]
        )
      : Promise.resolve([[] as RowDataPacket[]]),
  ]);

  return NextResponse.json({
    employee: selfRows[0],
    manager: managerRows[0] ?? null,
    directReports,
    peers,
  });
}
