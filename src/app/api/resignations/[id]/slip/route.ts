import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { getTerminationContext } from '@/lib/settlement';

// View Slip — the Full & Final Settlement statement, mirroring legacy's non-KWMT slip.ctp
// (EmployeeResignationController::Viewslip → get_emp_full_and_final_settle_slip) and its PDF
// twin download.ctp. Read-only view of what the last Process Full & Final run persisted; no
// recompute. KWMT / DEMO / GLET / ABSG variants (metro_slip, Notice Pay line, "Amount paid by
// the employee", ID-card rows, per-month grouping) are out of scope.
//
// Two legacy entry points map here: the list toolbar's "View Slip" (legacy gates it on
// emp_details.status == 2, i.e. actually terminated) and approves.ctp's "Generate Full and Final
// Slip" (produced straight after Process Full & Final, before removeemps()). So this unlocks at
// 'Approved' as well as 'Completed'; the list page still only surfaces it on Completed rows.
//
// Settlement rows are split four ways exactly as get_emp_full_and_final_settle_slip() does for the
// non-KWMT path:
//   SALARY  additions  — type = 'SALARY'  AND salary_amount >= 0 AND salary_head_item_fkey <> 111
//   SALARY  deductions — type = 'SALARY'  AND salary_amount <  0
//   OTHERS  additions  — type <> 'SALARY' AND salary_amount >= 0
//   OTHERS  deductions — type <> 'SALARY' AND salary_amount <  0
// salary_head_item_fkey 111 is the leave-encashment head, which legacy deliberately keeps OUT of
// the slip's Net on the non-KWMT path. Net Salary = sum of all four buckets (deductions are stored
// negative), matching slip.ctp's running $sum_add + $sum_ded across both its tables.

interface SlipLine {
  salary_head_item_desc: string;
  salary_amount: number;
}

// Ported from salaryslip.ctp's head-description cleanup: a trailing "YYYY-MM" becomes "MM-YYYY",
// and everything from "for the month" onward is dropped.
function cleanHeadDesc(raw: string | null): string {
  let s = (raw ?? '').trim();
  s = s.replace(/(\d{4})-(\d{2})$/, '$2-$1');
  const at = s.indexOf('for the month');
  if (at !== -1) s = s.slice(0, at).trim();
  return s;
}

const sum = (rows: SlipLine[]) => rows.reduce((acc, r) => acc + r.salary_amount, 0);

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
    'SELECT Reason FROM resignation_requests WHERE Resignation_pkey = ? AND status = 1',
    [id]
  );
  // Legacy Viewslip() works as soon as approves() has populated the settlement — there is no status
  // gate. Mirror that: the slip is available once emp_settle_slip rows exist for the employee.
  const [[settle]] = await pool.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM emp_settle_slip WHERE emp_fkey = ? AND status = 'Y'",
    [ctx.empFkey]
  );
  if (!rr || Number(settle?.n ?? 0) === 0) {
    return NextResponse.json({ error: 'Slip is only available once Full & Final has been processed' }, { status: 409 });
  }

  // Legacy slip.ctp letterhead: CompanyContactInfo.business_name (table comp_contact_info,
  // same source as GET /api/company).
  const [[comp]] = await pool.execute<RowDataPacket[]>(
    'SELECT business_name FROM comp_contact_info LIMIT 1'
  );

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
    `SELECT salary_head_item_desc, salary_amount, type, salary_head_item_fkey
     FROM emp_settle_slip WHERE emp_fkey = ? AND status = 'Y' ORDER BY emp_settle_slip_pkey`,
    [ctx.empFkey]
  );

  const line = (r: RowDataPacket): SlipLine => ({
    salary_head_item_desc: cleanHeadDesc(r.salary_head_item_desc),
    salary_amount: Number(r.salary_amount),
  });
  const isSalary = (r: RowDataPacket) => String(r.type) === 'SALARY';
  const amt = (r: RowDataPacket) => Number(r.salary_amount);

  const paydAdditions = settleRows
    .filter((r) => isSalary(r) && amt(r) >= 0 && Number(r.salary_head_item_fkey) !== 111)
    .map(line);
  const paydDeductions = settleRows.filter((r) => isSalary(r) && amt(r) < 0).map(line);
  const extraAdditions = settleRows.filter((r) => !isSalary(r) && amt(r) >= 0).map(line);
  const extraDeductions = settleRows.filter((r) => !isSalary(r) && amt(r) < 0).map(line);

  const paydAdditionsTotal = sum(paydAdditions);
  const paydDeductionsTotal = sum(paydDeductions);
  const extraAdditionsTotal = sum(extraAdditions);
  const extraDeductionsTotal = sum(extraDeductions);
  const netSalary = paydAdditionsTotal + paydDeductionsTotal + extraAdditionsTotal + extraDeductionsTotal;

  // Legacy slip.ctp: "Balance Working Days" = working_days_settled - payroll_days, but shown as 0
  // when working_days_settled is 0 (download.ctp uses > 0).
  const balanceWorkingDays =
    ctx.workingDaysSettled !== 0 ? ctx.workingDaysSettled - ctx.payrollDays : 0;

  return NextResponse.json({
    company: { businessName: comp?.business_name ?? null },
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
      // Legacy "Relieving Date" = Termination.act_last_working_day (only set via Edit / the
      // orphan-backfill); fall back to the approved last working date when it was never written.
      relievingDate: ctx.actLastWorkingDay ?? ctx.lastApprovedWd,
    },
    encashedDays: ctx.encashedDays,
    workingDaysSettled: ctx.workingDaysSettled,
    payrollDays: ctx.payrollDays,
    balanceWorkingDays,
    settlement: {
      paydAdditions,
      paydDeductions,
      extraAdditions,
      extraDeductions,
      paydAdditionsTotal,
      paydDeductionsTotal,
      extraAdditionsTotal,
      extraDeductionsTotal,
      netSalary,
    },
  });
}
