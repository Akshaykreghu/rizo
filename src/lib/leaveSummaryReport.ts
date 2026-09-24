import type { Pool, RowDataPacket } from 'mysql2/promise';
import { requireCriteria, buildCriteriaConditions, type CriteriaSelections } from './reports';

// Ports MiscellaniousReportsController::(the LeaveSummary branch of generatereport(), ~line
// 855-1050) / reportleavesummary.ctp — "Leave Details Reports" under Miscellaneous Reports. A
// single flat query (unlike LeaveBalance's per-employee/per-policy loop): every leave request
// overlapping the selected date range, with employee/branch/department, leave type, applied/from/
// to dates, authorizer/approver/rejecter name+remarks+date (rejecter resolved from whichever of
// Authorized/Approved actually happened first, matching legacy's exact ($val['APPROVED_date'] == ''
// ? Authorized : Approved) fallback), and leave days/status.

export interface LeaveSummaryReportParams {
  fromDate: string;
  toDate: string;
  includeResigned: boolean;
  criteria: CriteriaSelections;
}

export interface LeaveSummaryReportRow extends RowDataPacket {
  emp_name: string;
  employee_id: string;
  joining_date: string;
  branch: string;
  branch_code: string;
  department: string;
  leave_applied_on: string;
  leave_from: string;
  fromhalf: number;
  leave_to: string;
  tohalf: number;
  Reason: string;
  contact_person: string;
  Authorized_name: string | null;
  Authorized_remarks: string | null;
  Autherized_date: string | null;
  Approved_name: string | null;
  Approved_remarks: string | null;
  APPROVED_date: string | null;
  leave_type: string;
  leavedays: number;
  leave_status: string;
  status: number;
}

// Mirrors legacy's `(FROMDATE <= to AND TODATE >= from)` overlap condition — a leave request
// overlapping ANY part of the selected range is included, not just requests fully inside it.
export async function generateLeaveSummaryReport(pool: Pool, params: LeaveSummaryReportParams) {
  requireCriteria(params.criteria);
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'ed.branch_code', EmployeeDetails: 'ed.emp_pkey',
    LeaveType: 'lr.salary_head_item_fkey', Leavestatus: 'lr.LEAVESTATUS',
  });
  const statusClause = params.includeResigned ? `ed.status IN (1,2)` : `ed.status = 1`;

  const [rows] = await pool.execute<LeaveSummaryReportRow[]>(
    `SELECT
       (SELECT CONCAT(first_name, ' ', last_name) FROM emp_details WHERE emp_pkey = lr.ISAutherizedby) AS Authorized_name,
       (SELECT CONCAT(first_name, ' ', last_name) FROM emp_details WHERE emp_pkey = lr.APPROVEDBY) AS Approved_name,
       lr.LEAVEENTRYID, lr.Reason, lr.contact_person, lr.FROMHALF AS fromhalf, lr.TOHALF AS tohalf, lr.leave_days AS leavedays,
       lr.REMARKS, b.branch_name AS branch, ed.branch_code, ed.status,
       CONCAT(ed.first_name, ' ', ed.last_name) AS emp_name,
       i.employee_id, i.joining_date, i.department,
       shi.item AS leave_type,
       lr.applied_date AS leave_applied_on, lr.FROMDATE AS leave_from, lr.TODATE AS leave_to,
       lr.LEAVESTATUS AS leave_status, lr.AuthoriseRemarks AS Authorized_remarks, lr.ApproveRemarks AS Approved_remarks,
       lr.Autherized_date, lr.APPROVED_date
     FROM leaveentries lr
     LEFT JOIN emp_details ed ON lr.EMP_fkey = ed.emp_pkey
     LEFT JOIN salary_head_items shi ON lr.salary_head_item_fkey = shi.salary_head_item_pkey
     LEFT JOIN branches b ON ed.branch_code = b.branch_code
     LEFT JOIN employee_info i ON ed.emp_pkey = i.emp_pkey
     WHERE ${statusClause} AND (lr.FROMDATE <= ? AND lr.TODATE >= ?) AND ${conditions.join(' AND ')}
     ORDER BY ed.emp_pkey DESC`,
    [params.toDate, params.fromDate, ...args]
  );
  return rows;
}
