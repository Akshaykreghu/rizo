import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getTerminationContext, computeDayCountStats, computeNoticePay } from '@/lib/settlement';

// View Slip — a standalone printable Full & Final Settlement summary, mirroring legacy's
// full_and_final_slip.ctp/download.ctp (the GRTL/non-KWMT variant: no signature block, no
// per-month table). Reads the persisted emp_settle_slip rows from the last Process Full & Final
// run rather than recomputing — this is a read-only view of what was already committed. Legacy's
// real gate (confirmed via index.ctp's rowStyler/toolbar JS: View Slip and F&F Email Slip only
// enable when the row's joined emp_details.status == '2') is the employee's actual termination,
// not any intermediate resignation-workflow stage — so this only unlocks at 'Completed', matching
// that exactly (an earlier build of this feature allowed 'Approved' too, which was a mistaken
// assumption not yet verified against the real legacy view at the time).

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.userGroup !== 1) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const pool = await getCompanyPool(session.user.companyCode);

  const ctx = await getTerminationContext(pool, id);
  if (!ctx) return NextResponse.json({ error: 'Resignation request not found' }, { status: 404 });

  const [[rr]] = await pool.execute<RowDataPacket[]>(
    'SELECT Reason, Resignation_status FROM resignation_requests WHERE Resignation_pkey = ? AND status = 1',
    [id]
  );
  if (!rr || rr.Resignation_status !== 'Completed') {
    return NextResponse.json({ error: 'Slip is only available once the employee has been finalized (Finalize Termination)' }, { status: 409 });
  }

  const [[detail]] = await pool.execute<RowDataPacket[]>(
    `SELECT e.emp_id, ds.desig_name, d.dept_name, b.branch_name, p.joining_date
     FROM emp_details e
     LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
     LEFT JOIN designation ds ON ds.desig_code = p.designation
     LEFT JOIN department d ON d.dept_code = p.emp_dept
     LEFT JOIN branches b ON b.branch_code = p.emp_branch
     WHERE e.emp_pkey = ?`,
    [ctx.empFkey]
  );

  const [settleRows] = await pool.execute<RowDataPacket[]>(
    `SELECT salary_head_item_desc, salary_amount FROM emp_settle_slip WHERE emp_fkey = ? AND status = 'Y' ORDER BY emp_settle_slip_pkey`,
    [ctx.empFkey]
  );
  const additions = settleRows.filter((r) => Number(r.salary_amount) > 0);
  const deductions = settleRows.filter((r) => Number(r.salary_amount) <= 0);
  const netSalary = settleRows.reduce((sum, r) => sum + Number(r.salary_amount), 0);

  const dayStats = await computeDayCountStats(pool, ctx, ctx.workingDaysSettled);
  const noticePay = computeNoticePay(ctx, dayStats.offsActual);

  return NextResponse.json({
    employee: {
      first_name: ctx.firstName, last_name: ctx.lastName, emp_id: detail?.emp_id ?? null,
      designation: detail?.desig_name ?? null, department: detail?.dept_name ?? null,
      branch: detail?.branch_name ?? null, joining_date: detail?.joining_date ?? null,
    },
    reason: rr.Reason,
    resignationDetails: {
      submittedDate: ctx.submittedDate,
      noticePeriod: ctx.noticePeriod,
      lastWorkingDate: ctx.lastWorkingDate,
      approvedLastWorkingDate: ctx.lastApprovedWd,
    },
    additions,
    deductions,
    netSalary,
    noticePay,
    leaveBalance: ctx.leaveBalance,
    workingDaysSettled: ctx.workingDaysSettled,
  });
}
