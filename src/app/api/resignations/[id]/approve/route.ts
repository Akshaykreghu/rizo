import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import {
  getTerminationContext, computeDayCountStats, computeNoticePay,
  commitLeaveEncashment, getLoansAndAssets,
} from '@/lib/settlement';

// Mirrors legacy EmployeeResignationController::approves(): the second of legacy's two "Process
// Full & Final" steps — the actual commit (leave encashment + final_settle_pay_prc + settlement
// read-back), triggered from the preview screen (see GET .../preview) rather than being a single
// click. Scoped to the GRTL (non-KWMT/DEMO/GLET) path only — those tenants get an editable
// per-month settlement table in legacy; GRTL's is fully read-only, which is what this endpoint
// assembles and returns.
//
// final_settle_pay_prc's real signature (verified via SHOW CREATE PROCEDURE against the dev DB):
// (branch_code, month_year, emp_pkey, presant_days, encash_days, user_id, OUT error_message) — it
// depends on attendance_register data for that employee/branch/month, which this port hasn't built
// yet (Attendance phase not started), so it will very likely return "Attendance not verified" until
// that exists. We call it anyway and surface whatever it returns.
//
// leave_encash_prc's 5th param (perr_msg) is declared IN, not OUT, in the live DB — legacy itself
// never reads a result back from it (a legacy bug, not ported). We just call it and let a thrown
// SQL error surface via the transaction rollback if something's actually wrong.

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

  const ctx = await getTerminationContext(pool, id);
  if (!ctx) return NextResponse.json({ error: 'Resignation request not found' }, { status: 404 });

  const monthYear = String(body.month_year ?? new Date().toISOString().slice(0, 7));
  const presantDays = Number(body.presant_days ?? 0);
  const encashDays = Number(body.encash_days ?? 0);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const encashableLeaveBalance = await commitLeaveEncashment(
      connection, ctx.empFkey, ctx.branchCode, ctx.lastApprovedWd, session.user.loginUserId
    );

    await connection.query(
      'CALL final_settle_pay_prc(?, ?, ?, ?, ?, ?, @perror)',
      [ctx.branchCode, monthYear, ctx.empFkey, presantDays, encashDays, session.user.loginUserId]
    );
    const [[outRow]] = await connection.query<RowDataPacket[]>('SELECT @perror AS message');
    const settlementMessage: string | null = outRow?.message ?? null;

    const dayStats = await computeDayCountStats(connection, ctx, presantDays);
    const noticePay = computeNoticePay(ctx, dayStats.offsActual);

    // Settlement breakdown read-back — the central gap this pass closes: legacy shows the real
    // emp_settle_slip lines final_settle_pay_prc just computed; the prior version of this endpoint
    // only returned the bare procedure message.
    const [settleRows] = await connection.execute<RowDataPacket[]>(
      `SELECT salary_head_item_desc, salary_amount, type
       FROM emp_settle_slip WHERE emp_fkey = ? AND status = 'Y'
       ORDER BY emp_settle_slip_pkey`,
      [ctx.empFkey]
    );
    const additions = settleRows.filter((r) => Number(r.salary_amount) > 0);
    const deductions = settleRows.filter((r) => Number(r.salary_amount) <= 0);
    const netSalary = settleRows.reduce((sum, r) => sum + Number(r.salary_amount), 0);

    const { loans, assets } = await getLoansAndAssets(connection, ctx.empFkey);

    await connection.execute(
      "UPDATE termination SET is_approved = 'Y', approved_by = ? WHERE Resignation_pkey = ? AND status = 1",
      [Number(session.user.empFkey) || 0, id]
    );
    await connection.execute(
      "UPDATE resignation_accept SET isApproved = 1, approved_date = NOW() WHERE Resignation_pkey = ? AND status = 1",
      [id]
    );
    await connection.execute(
      "UPDATE resignation_requests SET Resignation_status = 'Approved' WHERE Resignation_pkey = ?",
      [id]
    );

    await connection.commit();
    return NextResponse.json({
      success: true,
      settlementMessage,
      settlement: {
        employee: { first_name: ctx.firstName, last_name: ctx.lastName },
        additions,
        deductions,
        netSalary,
        noticePay,
        encashableLeaveBalance,
        ...dayStats,
      },
      loans,
      assets,
    });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
