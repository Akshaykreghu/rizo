import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';

// Mirrors legacy EmployeeConfigController.php's addEmpTo{Shift,Leave,Holiday,Notice,Sallary,Div,Section,Grade}:
// an emp_config audit row per employee, plus updating the live emp_proff column those
// features actually read from. Employee Hierarchy and Leave Hierarchy are a separate
// mover-UI workflow, handled by /api/employees/hierarchy instead.
const TYPE_CONFIG: Record<string, { empProffColumn: string; resolveValue?: true }> = {
  SHIFT: { empProffColumn: 'day_time_seq' },
  LEAVE: { empProffColumn: 'LEAVEPOLICY_GROUP_ID' },
  HOLIDAY: { empProffColumn: 'HOLIDAY_GROUP_ID' },
  NOTICEPER: { empProffColumn: 'notice_days', resolveValue: true },
  DIVISION: { empProffColumn: 'emp_vertical' },
  SECTION: { empProffColumn: 'emp_sep_priv' },
  GRADE: { empProffColumn: 'emp_grade' },
};

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { type, policy_id, emp_fkeys } = body as { type: string; policy_id: number; emp_fkeys: number[] };

  if (!type || !policy_id || !Array.isArray(emp_fkeys) || !emp_fkeys.length) {
    return NextResponse.json({ error: 'type, policy_id, and emp_fkeys[] are required' }, { status: 400 });
  }

  const pool = await getCompanyPool(session.user.companyCode);

  if (type === 'SALARY') {
    const results: { emp_fkey: number; success: boolean }[] = [];
    for (const empFkey of emp_fkeys) {
      const [[row]] = await pool.execute<RowDataPacket[]>(
        'SELECT sal_structure_distribution_fn(?, ?, ?, ?) AS result',
        [session.user.companyCode, empFkey, policy_id, session.user.loginUserId]
      );
      const success = Number(row.result) === 1;
      results.push({ emp_fkey: empFkey, success });
      if (success) {
        const [[emp]] = await pool.execute<RowDataPacket[]>(
          'SELECT branch_code FROM emp_details WHERE emp_pkey = ?',
          [empFkey]
        );
        await pool.execute(
          `INSERT INTO emp_config (type, company_code, branch_code, emp_fkey, policy_id, created_by, status)
           VALUES ('SALARY', ?, ?, ?, ?, ?, 1)`,
          [session.user.companyCode, emp?.branch_code ?? null, empFkey, policy_id, session.user.loginUserId]
        );
      }
    }
    const failed = results.filter((r) => !r.success).map((r) => r.emp_fkey);
    return NextResponse.json({
      success: true,
      assigned: results.filter((r) => r.success).length,
      failed,
      failedNote: failed.length ? 'These employees likely have no active CTC assigned yet — assign CTC first.' : undefined,
    });
  }

  const config = TYPE_CONFIG[type];
  if (!config) {
    return NextResponse.json({ error: `Unsupported policy type: ${type}` }, { status: 400 });
  }

  let empProffValue: number | string = policy_id;
  if (config.resolveValue) {
    const [[notice]] = await pool.execute<RowDataPacket[]>(
      'SELECT notice_days FROM notice_period WHERE notice_pkey = ?',
      [policy_id]
    );
    if (!notice) return NextResponse.json({ error: 'Notice period not found' }, { status: 404 });
    empProffValue = notice.notice_days;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const empFkey of emp_fkeys) {
      const [[emp]] = await connection.execute<RowDataPacket[]>(
        'SELECT branch_code FROM emp_details WHERE emp_pkey = ?',
        [empFkey]
      );

      await connection.execute(
        `INSERT INTO emp_config (type, company_code, branch_code, emp_fkey, policy_id, created_by, status)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [type, session.user.companyCode, emp?.branch_code ?? null, empFkey, policy_id, session.user.loginUserId]
      );

      await connection.execute(
        `UPDATE emp_proff SET ${config.empProffColumn} = ? WHERE emp_fkey = ?`,
        [empProffValue, empFkey]
      );
    }

    await connection.commit();
    return NextResponse.json({ success: true, assigned: emp_fkeys.length });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
