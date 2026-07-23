import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors legacy EmployeeConfigController.php's Employee Hierarchy (reporting-manager tree,
// type='HIERARCHY', denormalized onto emp_proff.attr1, ordered via emp_config.hirc_leval) and
// Leave Hierarchy (leave-approver pairing, type='LAPPR', no denorm column, no ordering).

const EMP_JOIN = `
  FROM emp_details e
  LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
  LEFT JOIN branches b ON b.branch_code = p.emp_branch
  LEFT JOIN department d ON d.dept_code = p.emp_dept
  LEFT JOIN designation ds ON ds.desig_code = p.designation
`;
const SELECT_COLS = 'e.emp_pkey, e.first_name, e.last_name, e.emp_id, b.branch_name, d.dept_name, ds.desig_name';

function validType(type: string | null): type is 'HIERARCHY' | 'LAPPR' {
  return type === 'HIERARCHY' || type === 'LAPPR';
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const parentId = Number(searchParams.get('parentId'));
  if (!validType(type) || !parentId) {
    return NextResponse.json({ error: 'type and parentId are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [assigned] = await pool.execute<RowDataPacket[]>(
    `SELECT ${SELECT_COLS}, c.hirc_leval
     ${EMP_JOIN}
     JOIN emp_config c ON c.emp_fkey = e.emp_pkey
     WHERE c.type = ? AND c.policy_id = ? AND c.status = 1
     ORDER BY c.hirc_leval ASC, e.first_name ASC`,
    [type, parentId]
  );

  let available: RowDataPacket[];
  if (type === 'HIERARCHY') {
    [available] = await pool.execute<RowDataPacket[]>(
      `SELECT ${SELECT_COLS}
       ${EMP_JOIN}
       WHERE e.status = 1 AND e.emp_pkey != ? AND (p.attr1 IS NULL OR p.attr1 = '' OR p.attr1 = '0')
       ORDER BY e.first_name`,
      [parentId]
    );
  } else {
    [available] = await pool.execute<RowDataPacket[]>(
      `SELECT ${SELECT_COLS}
       ${EMP_JOIN}
       WHERE e.status = 1 AND e.emp_pkey != ?
         AND NOT EXISTS (
           SELECT 1 FROM emp_config x WHERE x.type = 'LAPPR' AND x.policy_id = ? AND x.emp_fkey = e.emp_pkey AND x.status = 1
         )
         AND NOT EXISTS (
           SELECT 1 FROM emp_config y WHERE y.type = 'LAPPR' AND y.emp_fkey = ? AND y.policy_id = e.emp_pkey AND y.status = 1
         )
       ORDER BY e.first_name`,
      [parentId, parentId, parentId]
    );
  }

  return NextResponse.json({ available, assigned });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { type, parentId, action } = body as { type: string; parentId: number; action: string };
  if (!validType(type) || !parentId || !action) {
    return NextResponse.json({ error: 'type, parentId, and action are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  if (action === 'add') {
    const empFkeys = (body.empFkeys ?? []) as number[];
    if (!empFkeys.length) return NextResponse.json({ error: 'empFkeys[] required' }, { status: 400 });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      let nextLevel = 1;
      if (type === 'HIERARCHY') {
        const [[row]] = await connection.execute<RowDataPacket[]>(
          `SELECT COALESCE(MAX(hirc_leval), 0) + 1 AS next FROM emp_config WHERE type = 'HIERARCHY' AND policy_id = ? AND status = 1`,
          [parentId]
        );
        nextLevel = row.next;
      }

      for (const empFkey of empFkeys) {
        const [[emp]] = await connection.execute<RowDataPacket[]>(
          'SELECT branch_code FROM emp_details WHERE emp_pkey = ?',
          [empFkey]
        );
        await connection.execute(
          `INSERT INTO emp_config (type, company_code, branch_code, emp_fkey, policy_id, hirc_leval, created_by, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            type,
            session.user.companyCode,
            emp?.branch_code ?? null,
            empFkey,
            parentId,
            type === 'HIERARCHY' ? nextLevel++ : null,
            session.user.loginUserId,
          ]
        );
        if (type === 'HIERARCHY') {
          await connection.execute('UPDATE emp_proff SET attr1 = ? WHERE emp_fkey = ?', [String(parentId), empFkey]);
        }
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

  if (action === 'remove') {
    const empFkey = Number(body.empFkey);
    if (!empFkey) return NextResponse.json({ error: 'empFkey required' }, { status: 400 });

    await pool.execute(
      `UPDATE emp_config SET status = 0, modified_by = ?, modification_date = NOW()
       WHERE type = ? AND policy_id = ? AND emp_fkey = ? AND status = 1`,
      [session.user.loginUserId, type, parentId, empFkey]
    );
    if (type === 'HIERARCHY') {
      await pool.execute('UPDATE emp_proff SET attr1 = NULL WHERE emp_fkey = ?', [empFkey]);
    }
    return NextResponse.json({ success: true });
  }

  if (action === 'reorder') {
    if (type !== 'HIERARCHY') {
      return NextResponse.json({ error: 'Reorder only applies to Employee Hierarchy' }, { status: 400 });
    }
    const orderedEmpFkeys = (body.orderedEmpFkeys ?? []) as number[];

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (let i = 0; i < orderedEmpFkeys.length; i++) {
        await connection.execute(
          `UPDATE emp_config SET hirc_leval = ? WHERE type = 'HIERARCHY' AND policy_id = ? AND emp_fkey = ? AND status = 1`,
          [i + 1, parentId, orderedEmpFkeys[i]]
        );
        // emp_config_au (an existing DB trigger) unconditionally NULLs emp_proff.attr1 on ANY
        // update to an emp_config row of type HIERARCHY, not just removals — restore the
        // manager assignment immediately after each reorder update or it gets silently wiped.
        await connection.execute('UPDATE emp_proff SET attr1 = ? WHERE emp_fkey = ?', [String(parentId), orderedEmpFkeys[i]]);
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

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
