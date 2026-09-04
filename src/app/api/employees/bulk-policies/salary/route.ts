import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket, PoolConnection } from 'mysql2/promise';
import { allocateSalaryStructure } from '@/lib/salaryStructureAllocate';

// Salary Structure tab of the legacy "Bulk Policy Allocation" screen
// (EmployeeConfig/index.ctp tab5 + EmployeeConfigController.php). Ported per
// legacy/Bulk_Policy_Salary_Structure_Migration_Plan.md.
//
//  GET  ?structureId=..            -> { candidates, allocated }   (listemployeesforsalary / listemployeesinsalary)
//  POST { action:'assign', .. }    -> addEmpToSallary   (one employee)
//  POST { action:'remove', .. }    -> removeEmpFromSallary (one employee)
//
// The assign() core (ctc_upload_type reset -> sal_structure_distribution_fn -> remark recompute
// -> emp_config insert -> salary_structure_limit_prc) lives in @/lib/salaryStructureAllocate so
// the Salary Increment structure-change path shares one implementation. emp_proff.structure_id
// is maintained entirely by the live DB triggers emp_config_bi / emp_config_au (see the plan doc).

const EMP_COLS = `
  e.emp_pkey, e.first_name, e.last_name, e.emp_id,
  b.branch_name, ds.desig_name
`;
const EMP_JOINS = `
  FROM emp_details e
  JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
  LEFT JOIN branches b ON b.branch_code = p.emp_branch
  LEFT JOIN designation ds ON ds.desig_code = p.designation
  LEFT JOIN emp_ctc_transaction t ON t.emp_fkey = e.emp_pkey AND t.end_date_effective IS NULL
`;
// Monthly CTC: DAILY WAGES uses the stored annual figure as-is (legacy sal_structure_distribution_fn
// and listemployeesforsalary both special-case only 'DAILY WAGES'); everyone else is annual / 12.
const MONTHLY_CTC = `CASE WHEN UPPER(p.emp_type) = 'DAILY WAGES' THEN t.emp_anual_ctc ELSE t.emp_anual_ctc / 12 END`;

interface EmpRow extends RowDataPacket {
  emp_pkey: number;
  first_name: string;
  last_name: string | null;
  emp_id: string;
  branch_name: string | null;
  desig_name: string | null;
  gross: number | null;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const structureId = Number(new URL(request.url).searchParams.get('structureId'));
  if (!structureId) {
    return NextResponse.json({ error: 'structureId is required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  const [[structure]] = await pool.execute<RowDataPacket[]>(
    'SELECT structure_id, structure_name, structure_eg_amt FROM salary_structure WHERE structure_id = ?',
    [structureId]
  );
  if (!structure) {
    return NextResponse.json({ error: 'Salary structure not found' }, { status: 404 });
  }
  const egAmt = Number(structure.structure_eg_amt) || 0;

  // Non-Allocated Employees: active, not on any structure, monthly CTC >= this structure's eligible gross.
  const [candidates] = await pool.execute<EmpRow[]>(
    `SELECT ${EMP_COLS}, ROUND(${MONTHLY_CTC}) AS gross
     ${EMP_JOINS}
     WHERE e.status = 1
       AND (p.structure_id IS NULL OR p.structure_id = 0)
       AND ${MONTHLY_CTC} >= ?
     ORDER BY e.first_name, e.last_name`,
    [egAmt]
  );

  // Employees in selected salary structure: emp_config SALARY rows for this structure.
  const [allocated] = await pool.execute<EmpRow[]>(
    `SELECT ${EMP_COLS}, ROUND(t.emp_anual_ctc / 12) AS gross
     ${EMP_JOINS}
     JOIN emp_config c ON c.emp_fkey = e.emp_pkey AND c.type = 'SALARY' AND c.policy_id = ? AND c.status = 1
     ORDER BY e.first_name, e.last_name`,
    [structureId]
  );

  return NextResponse.json({
    structure: { structure_id: structure.structure_id, structure_name: structure.structure_name, structure_eg_amt: egAmt },
    candidates,
    allocated,
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as { action?: string; structureId?: number; empFkey?: number };
  const { action, structureId, empFkey } = body;
  if (!action || !structureId || !empFkey) {
    return NextResponse.json({ error: 'action, structureId, and empFkey are required' }, { status: 400 });
  }

  const companyCode = session.user.companyCode;
  const userId = session.user.loginUserId;
  const pool = await getCompanyPool(companyCode);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    let result: NextResponse;

    if (action === 'assign') {
      result = await assign(conn, companyCode, userId, structureId, empFkey);
    } else if (action === 'remove') {
      result = await remove(conn, userId, structureId, empFkey);
    } else {
      await conn.rollback();
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Port of EmployeeConfigController::addEmpToSallary for a single employee — delegates the
// distribution / remark-recompute / audit / limit-proc sequence to the shared helper.
async function assign(
  conn: PoolConnection,
  companyCode: string,
  userId: string,
  structureId: number,
  empFkey: number,
): Promise<NextResponse> {
  const { ok, formulaWarnings } = await allocateSalaryStructure(conn, {
    companyCode, userId, empFkey, structureId,
  });

  if (!ok) {
    return NextResponse.json({
      success: false,
      assigned: 0,
      failed: [empFkey],
      failedNote: 'sal_structure_distribution_fn returned 0 — the employee likely has no active CTC row yet. Assign CTC first.',
      formulaWarnings,
    });
  }

  return NextResponse.json({ success: true, assigned: 1, failed: [], formulaWarnings });
}

// Port of EmployeeConfigController::removeEmpFromSallary for a single employee.
async function remove(
  conn: PoolConnection,
  userId: string,
  structureId: number,
  empFkey: number,
): Promise<NextResponse> {
  // Soft-delete the audit row; emp_config_au trigger nulls emp_proff.structure_id.
  const [res] = await conn.execute(
    `UPDATE emp_config SET modified_by = ?, modification_date = NOW(), status = 0
     WHERE type = 'SALARY' AND emp_fkey = ? AND policy_id = ? AND status = 1`,
    [userId, empFkey, structureId]
  );

  // End-date every open structure row for this employee (legacy does not filter by structure here).
  await conn.execute(
    `UPDATE emp_salary_structure SET end_date_effective = CURDATE()
     WHERE emp_fkey = ? AND end_date_effective IS NULL`,
    [empFkey]
  );

  const affected = (res as RowDataPacket & { affectedRows?: number }).affectedRows ?? 0;
  return NextResponse.json({ success: true, removed: affected });
}
