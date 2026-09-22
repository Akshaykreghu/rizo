import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { Pool, RowDataPacket } from 'mysql2/promise';

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

// Walks emp_proff.attr1 upward from empPkey (manager, manager's manager, ...) so the
// "entire team" descendant walk can exclude the whole chain. This dataset has a confirmed
// real cycle (see project memory) where a descendant several levels down loops back and
// points at one of empPkey's own ancestors — without this exclusion, that ancestor (and
// their real reports, i.e. empPkey's own peers) gets pulled into "your team" as if they
// were subordinates. Capped at 30 hops as a safety net against a cycle in this direction too.
async function getAncestorIds(pool: Pool, startId: number): Promise<number[]> {
  const ancestors: number[] = [];
  let current = startId;
  for (let i = 0; i < 30; i++) {
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT attr1 FROM emp_proff WHERE emp_fkey = ?', [current]);
    const nextId = Number(rows[0]?.attr1) || null;
    if (!nextId || nextId === startId || ancestors.includes(nextId)) break;
    ancestors.push(nextId);
    current = nextId;
  }
  return ancestors;
}

export async function GET(
  request: NextRequest,
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
  const wantsFullTeam = request.nextUrl.searchParams.get('scope') === 'all';

  const [[selfRows], [managerAttrRows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(`SELECT ${PERSON_COLS} ${PERSON_JOIN} WHERE e.emp_pkey = ?`, [empPkey]),
    pool.execute<RowDataPacket[]>('SELECT attr1 FROM emp_proff WHERE emp_fkey = ?', [empPkey]),
  ]);

  if (!selfRows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const managerId = Number(managerAttrRows[0]?.attr1) || null;

  const [[managerRows], [directReports], [peers], allReports] = await Promise.all([
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
    // "Entire Team" view (?scope=all): walks emp_proff.attr1 down every level below empPkey,
    // not just direct reports. Excludes empPkey itself AND its whole ancestor chain (see
    // getAncestorIds) — this dataset has a confirmed real cycle where a descendant several
    // levels down loops back and points at one of empPkey's own ancestors, and without also
    // excluding ancestors, that manager (and their real reports, i.e. empPkey's own peers)
    // gets pulled in as if they were subordinates. `path` + FIND_IN_SET additionally guards
    // against a bad manager loop among the true descendants themselves, so it terminates that
    // branch instead of hitting MySQL's cte_max_recursion_depth abort; CAST(p.attr1 AS
    // UNSIGNED) = s.emp_pkey (rather than casting emp_pkey to a string) sidesteps attr1's
    // legacy latin1_swedish_ci collation.
    wantsFullTeam
      ? getAncestorIds(pool, empPkey).then(async (ancestorIds) => {
          const excludeIds = [empPkey, ...ancestorIds];
          const excludeSql = excludeIds.map(() => '?').join(',');
          const [rows] = await pool.execute<RowDataPacket[]>(
            `WITH RECURSIVE subtree AS (
               SELECT e.emp_pkey, p.attr1 AS manager_id, 1 AS depth, CAST(e.emp_pkey AS CHAR(4000)) AS path
               ${PERSON_JOIN}
               WHERE e.status = 1 AND p.attr1 = ? AND e.emp_pkey NOT IN (${excludeSql})
               UNION ALL
               SELECT e.emp_pkey, p.attr1 AS manager_id, s.depth + 1, CONCAT(s.path, ',', e.emp_pkey)
               FROM emp_details e
               LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
               INNER JOIN subtree s ON CAST(p.attr1 AS UNSIGNED) = s.emp_pkey
               WHERE e.status = 1 AND e.emp_pkey NOT IN (${excludeSql}) AND FIND_IN_SET(e.emp_pkey, s.path) = 0
             )
             SELECT ${PERSON_COLS}, CAST(subtree.manager_id AS UNSIGNED) AS manager_id, subtree.depth
             ${PERSON_JOIN}
             INNER JOIN subtree ON subtree.emp_pkey = e.emp_pkey
             ORDER BY subtree.depth, e.first_name`,
            [String(empPkey), ...excludeIds, ...excludeIds]
          );
          return rows;
        })
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    employee: selfRows[0],
    manager: managerRows[0] ?? null,
    directReports,
    peers,
    ...(allReports ? { allReports } : {}),
  });
}
