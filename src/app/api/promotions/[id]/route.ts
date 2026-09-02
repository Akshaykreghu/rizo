import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors legacy PromoController::approvesave()/rejsave(): a single central approval step that,
// on approve, cascades the requested changes onto the live employee record — direct emp_proff
// field changes (designation/department/branch/type), emp_config-audited policy assignments
// (shift/leave, same convention as Bulk Policies), a salary-structure change via the real
// sal_structure_distribution_fn stored function, a CTC row, and a reporting-manager change
// (same convention as the Employee Hierarchy mover). approved_by is a NOT NULL int column
// conceptually referencing an approving employee's emp_pkey; admin sessions in this app have no
// linked emp_fkey, so 0 is used as an explicit "system/admin" sentinel — matches a convention
// already observed elsewhere in this schema's emp_config rows.

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const pool = await getCompanyPool(session.user.companyCode);
  const today = new Date().toISOString().slice(0, 10);
  // Legacy promotionWage() dates the new CTC to the 1st of the current month, not "today".
  const monthStart = `${today.slice(0, 8)}01`;
  const approverId = Number(session.user.empFkey) || 0;

  const [[promo]] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM promotions WHERE promotion_pkey = ? AND status = 1',
    [id]
  );
  if (!promo) return NextResponse.json({ error: 'Promotion request not found' }, { status: 404 });
  if (promo.approved_status !== 'N') {
    return NextResponse.json({ error: 'This request has already been processed' }, { status: 409 });
  }

  if (body.action === 'reject') {
    await pool.execute(
      `UPDATE promotions SET approved_status = 'R', approved_by = ?, approved_date = ?, promotion_status = 'REJECTED'
       WHERE promotion_pkey = ?`,
      [approverId, today, id]
    );
    return NextResponse.json({ success: true });
  }
  if (body.action !== 'approve') {
    return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 });
  }

  const empFkey = promo.emp_fkey;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [[emp]] = await connection.execute<RowDataPacket[]>(
      'SELECT branch_code FROM emp_details WHERE emp_pkey = ?',
      [empFkey]
    );

    const directUpdates: string[] = [];
    const directParams: (string | number)[] = [];
    if (promo.designation) { directUpdates.push('designation = ?'); directParams.push(promo.designation); }
    if (promo.emp_dept) { directUpdates.push('emp_dept = ?'); directParams.push(promo.emp_dept); }
    if (promo.emp_branch) { directUpdates.push('emp_branch = ?'); directParams.push(promo.emp_branch); }
    if (promo.emp_type) { directUpdates.push('emp_type = ?'); directParams.push(promo.emp_type); }
    if (promo.shift) { directUpdates.push('day_time_seq = ?'); directParams.push(promo.shift); }
    if (promo.leave) { directUpdates.push('LEAVEPOLICY_GROUP_ID = ?'); directParams.push(promo.leave); }
    if (directUpdates.length) {
      await connection.execute(
        `UPDATE emp_proff SET ${directUpdates.join(', ')} WHERE emp_fkey = ?`,
        [...directParams, empFkey]
      );
    }

    // Legacy changeDesignation()/changeDepartment()/changeBranch() also write an emp_config audit
    // row (type DESIG/DEPARTMENTS/BRANCH, policy_id = the numeric `id` of the master row, not its
    // code), deactivating any prior row of that type for the employee first. changeType()'s
    // equivalent block is commented out in legacy, so no TYPE row is written here either.
    const codeAudits: { type: string; table: string; codeCol: string; code: string | null }[] = [
      { type: 'DESIG', table: 'designation', codeCol: 'desig_code', code: promo.designation || null },
      { type: 'DEPARTMENTS', table: 'department', codeCol: 'dept_code', code: promo.emp_dept || null },
      { type: 'BRANCH', table: 'branches', codeCol: 'branch_code', code: promo.emp_branch || null },
    ];
    for (const audit of codeAudits) {
      if (!audit.code) continue;
      const [[master]] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM ${audit.table} WHERE ${audit.codeCol} = ? AND status = 1`,
        [audit.code]
      );
      if (!master) continue;
      await connection.execute(
        `UPDATE emp_config SET modified_by = ?, modification_date = NOW(), status = 0
         WHERE type = ? AND emp_fkey = ? AND status = 1`,
        [session.user.loginUserId, audit.type, empFkey]
      );
      await connection.execute(
        `INSERT INTO emp_config (type, company_code, branch_code, emp_fkey, policy_id, created_by, status)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [audit.type, session.user.companyCode, emp?.branch_code ?? null, empFkey, master.id, session.user.loginUserId]
      );
    }

    if (promo.shift) {
      await connection.execute(
        `INSERT INTO emp_config (type, company_code, branch_code, emp_fkey, policy_id, created_by, status)
         VALUES ('SHIFT', ?, ?, ?, ?, ?, 1)`,
        [session.user.companyCode, emp?.branch_code ?? null, empFkey, promo.shift, session.user.loginUserId]
      );
    }
    if (promo.leave) {
      await connection.execute(
        `INSERT INTO emp_config (type, company_code, branch_code, emp_fkey, policy_id, created_by, status)
         VALUES ('LEAVE', ?, ?, ?, ?, ?, 1)`,
        [session.user.companyCode, emp?.branch_code ?? null, empFkey, promo.leave, session.user.loginUserId]
      );
    }

    // CTC must exist before sal_structure_distribution_fn runs — the function requires an
    // active CTC row for the employee (same prerequisite observed in Bulk Policies' SALARY
    // type), so insert it first.
    if (promo.annual_gross) {
      await connection.execute(
        `INSERT INTO emp_ctc_upload (emp_fkey, emp_anual_ctc, created_by, start_date_effective)
         VALUES (?, ?, ?, ?)`,
        [empFkey, Number(promo.annual_gross), session.user.loginUserId, monthStart]
      );
    }

    if (promo.salary) {
      const [[result]] = await connection.execute<RowDataPacket[]>(
        'SELECT sal_structure_distribution_fn(?, ?, ?, ?) AS result',
        [session.user.companyCode, empFkey, promo.salary, session.user.loginUserId]
      );
      if (Number(result.result) === 1) {
        await connection.execute(
          `INSERT INTO emp_config (type, company_code, branch_code, emp_fkey, policy_id, created_by, status)
           VALUES ('SALARY', ?, ?, ?, ?, ?, 1)`,
          [session.user.companyCode, emp?.branch_code ?? null, empFkey, promo.salary, session.user.loginUserId]
        );
      }
    }

    if (promo.hierarch) {
      const parentId = Number(promo.hierarch);
      const [[row]] = await connection.execute<RowDataPacket[]>(
        `SELECT COALESCE(MAX(hirc_leval), 0) + 1 AS next FROM emp_config WHERE type = 'HIERARCHY' AND policy_id = ? AND status = 1`,
        [parentId]
      );
      await connection.execute(
        `INSERT INTO emp_config (type, company_code, branch_code, emp_fkey, policy_id, hirc_leval, created_by, status)
         VALUES ('HIERARCHY', ?, ?, ?, ?, ?, ?, 1)`,
        [session.user.companyCode, emp?.branch_code ?? null, empFkey, parentId, row.next, session.user.loginUserId]
      );
      await connection.execute('UPDATE emp_proff SET attr1 = ? WHERE emp_fkey = ?', [String(parentId), empFkey]);
    }

    await connection.execute(
      `UPDATE promotions SET approved_status = 'Y', approved_by = ?, approved_date = ?, promotion_status = 'APPROVED'
       WHERE promotion_pkey = ?`,
      [approverId, today, id]
    );

    await connection.commit();
    return NextResponse.json({ success: true });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
