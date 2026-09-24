import type { Pool, RowDataPacket } from 'mysql2/promise';
import { requireCriteria, buildCriteriaConditions, type CriteriaSelections } from './reports';

// Ports MiscellaniousReportsController::generateleavebalancemonthlyreportnew() (confirmed live
// routed function for GRTL — company_code isn't DEMO/SRTS and isn't in the MonthlyLeave
// restricted-companies list, both checked against the dispatcher at line 601-609) — "Monthly Leave
// Taken Register" under Miscellaneous Reports. One row per APPROVED leave date actually taken in
// the selected month (joins emp_leave_transactions, not the leaveentries date range — a multi-day
// leave produces one row per calendar day taken that falls in-month). Per source read, legacy's own
// function only ever implements the EmployeeDetails criteria branch (no Units/branch-wise `else`
// exists in this function, unlike LeaveBalance/LeaveSummary) — matched here rather than invented.

export interface MonthlyLeaveReportParams {
  monthYear: string; // 'YYYY-MM'
  includeResigned: boolean;
  criteria: CriteriaSelections;
}

export interface MonthlyLeaveReportRow extends RowDataPacket {
  emp_pkey: number;
  emp_name: string;
  employee_id: string;
  user_id: string | null;
  joining_date: string;
  branch_name: string;
  department: string;
  designation: string;
  last_approved_working_date: string | null;
  leave_policy_type: string;
  leave_type: string;
  leave_date: string;
  applied_date: string;
  Autherized_date: string | null;
  authorized_by_name: string | null;
  APPROVED_date: string | null;
  approved_by_name: string | null;
  status: number;
}

export async function generateMonthlyLeaveReport(pool: Pool, params: MonthlyLeaveReportParams) {
  requireCriteria(params.criteria);
  // Only EmployeeDetails is meaningful here (see header comment) — Units, if ever selected, simply
  // yields no filter beyond the employee status clause, matching legacy's own silent no-op for any
  // criteria other than EmployeeDetails in this specific function.
  const { conditions, args } = buildCriteriaConditions(params.criteria, { EmployeeDetails: 'ed.emp_pkey' });
  const statusClause = params.includeResigned ? `ed.status IN (1,2)` : `ed.status = 1`;

  const [rows] = await pool.execute<MonthlyLeaveReportRow[]>(
    `SELECT ed.emp_pkey, CONCAT(ed.first_name, ' ', ed.last_name) AS emp_name,
            i.employee_id, uc.user_id, i.joining_date, i.department, i.designation,
            b.branch_name, ed.status,
            lp.leave_policy_type, shi.item AS leave_type,
            le.LEAVESTATUS, le.applied_date, le.Autherized_date, le.APPROVED_date, elt.leave_date,
            term.last_approved_working_date,
            le.ISAutherizedby, CONCAT(auth.first_name, ' ', auth.last_name) AS authorized_by_name,
            le.APPROVEDBY, CONCAT(app.first_name, ' ', app.last_name) AS approved_by_name
     FROM emp_details ed
     JOIN emp_proff ep ON ed.emp_pkey = ep.emp_fkey
     LEFT JOIN user_credentials uc ON uc.emp_fkey = ed.emp_pkey
     JOIN leaveentries le ON le.EMP_fkey = ep.emp_fkey AND le.LEAVESTATUS = 'Approved'
     JOIN emp_leave_transactions elt ON elt.LEAVEENTRYID = le.LEAVEENTRYID AND DATE_FORMAT(elt.leave_date, '%Y-%m') = ?
     JOIN leavepolicy lp ON lp.LEAVEPOLICY_GROUP_ID = ep.LEAVEPOLICY_GROUP_ID AND lp.status = 1
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = le.salary_head_item_fkey
     JOIN employee_info i ON i.emp_pkey = ed.emp_pkey
     LEFT JOIN branches b ON b.branch_code = ed.branch_code
     LEFT JOIN termination term ON term.emp_fkey = ep.emp_fkey AND term.status = 1
     LEFT JOIN emp_details auth ON auth.emp_pkey = le.ISAutherizedby
     LEFT JOIN emp_details app ON app.emp_pkey = le.APPROVEDBY
     WHERE ${statusClause} AND ${conditions.join(' AND ')}
     GROUP BY elt.LEAVEENTRYID, elt.leave_date
     ORDER BY ed.emp_pkey`,
    [params.monthYear, ...args]
  );
  return rows;
}
