import type { Pool, RowDataPacket } from 'mysql2/promise';
import { requireCriteria, buildCriteriaConditions, type CriteriaSelections } from './reports';

// Ports AttendanceReportsNewController.php (confirmed live-routed controller for GRTL — the
// separate old AttendanceReportsController.php has 3 abandoned backup files and is not used by
// this tenant; ReportController.php's $pathMap only remaps to it for a 16-company blocklist GRTL
// isn't in). GRTL's real report-type menu (hrreportsNew(), non-special-tenant branch) is 6 types:
// VerifiedAttendance, DetailedAttendance, OvertimeReport, Overtime, Dashboard, regularisation —
// all confirmed live against `reportcriterias`. The doc's "Attendance Register_New" default type
// is gated to a 7-company special list GRTL isn't in, so it's not offered here.

export interface AttendanceRegisterParams {
  monthYear: string; // 'YYYY-MM'
  criteria: CriteriaSelections;
}

// Mirrors generateVerifiedAttendancereport() — reads the already-populated `attendance_register`
// (populated by the existing Process Register action, which CALLs insert_update_att_reg — a
// report shouldn't trigger that side-effecting population itself, matching this project's
// established boundary that reports read, they don't process).
export async function generateAttendanceRegisterReport(pool: Pool, params: AttendanceRegisterParams) {
  requireCriteria(params.criteria);
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'ar.branch_code', EmployeeDetails: 'ar.emp_fkey',
  });
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ar.emp_fkey, ar.emp_name, b.branch_name, ar.month_year,
            ar.presant_total, ar.leave_total, ar.lop_total, ar.holiday_total, ar.weekoff_total, ar.working_days
     FROM attendance_register ar
     LEFT JOIN branches b ON b.branch_code = ar.branch_code
     WHERE ar.month_year = ? AND ar.isdelete = 'N' AND ${conditions.join(' AND ')}
     ORDER BY ar.emp_name`,
    [params.monthYear, ...args]
  );
  return rows;
}

export interface DetailedAttendanceParams {
  monthYear: string;
  criteria: CriteriaSelections;
}

// Mirrors generateDetailedreport() — raw device punch log, one row per punch (not aggregated per
// day). device_attandance.emp_id is a varchar matching emp_details.emp_id, not emp_pkey.
export async function generateDetailedAttendanceReport(pool: Pool, params: DetailedAttendanceParams) {
  requireCriteria(params.criteria);
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'ed.branch_code', EmployeeDetails: 'ed.emp_pkey',
  });
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ed.emp_pkey, CONCAT(ed.first_name, ' ', COALESCE(ed.last_name, '')) AS emp_name,
            b.branch_name, d.dept_name, da.LOGDATE, da.C1 AS punch_type, da.C2, da.C3
     FROM device_attandance da
     JOIN emp_details ed ON ed.emp_id = da.emp_id
     LEFT JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
     LEFT JOIN branches b ON b.branch_code = ed.branch_code
     LEFT JOIN department d ON d.dept_code = ep.emp_dept
     WHERE DATE_FORMAT(da.LOGDATE, '%Y-%m') = ? AND ${conditions.join(' AND ')}
     ORDER BY ed.emp_pkey, da.LOGDATE`,
    [params.monthYear, ...args]
  );
  return rows;
}

export interface OvertimeDetailParams {
  monthYear: string;
  criteria: CriteriaSelections;
}

// Mirrors generateOvertimereport() — day-level OT duration detail, sourced from
// emp_ot_timeattandance (yearmonth = 'YYYY-MM-01'). Distinct from the 'Overtime' subtype below
// (approved monthly summary) despite the near-identical legacy labels ("Overtime Reports" vs
// "Approved Over Time") — confirmed via source read they're genuinely different report shapes,
// not a UI duplicate.
export async function generateOvertimeDetailReport(pool: Pool, params: OvertimeDetailParams) {
  requireCriteria(params.criteria);
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'ed.branch_code', EmployeeDetails: 'ed.emp_pkey',
  });
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ed.emp_pkey, CONCAT(ed.first_name, ' ', COALESCE(ed.last_name, '')) AS emp_name,
            b.branch_name, eot.att_date, eot.ot_duration, eot.remarks
     FROM emp_ot_timeattandance eot
     JOIN emp_details ed ON ed.emp_pkey = eot.emp_pkey
     LEFT JOIN branches b ON b.branch_code = ed.branch_code
     WHERE eot.yearmonth = ? AND eot.isdelete = 'N' AND eot.ot_duration > 0 AND ${conditions.join(' AND ')}
     ORDER BY ed.emp_pkey, eot.att_date`,
    [`${params.monthYear}-01`, ...args]
  );
  return rows;
}

export interface ApprovedOvertimeParams {
  monthYear: string;
  criteria: CriteriaSelections;
}

// Mirrors 'Overtime' report type / Overtimereport() — the approved monthly OT summary, sourced
// from emp_ot_master (the same table the existing OtAttendanceNewController approval flow writes
// to via emp_ot_master.is_verified/set_duration).
export async function generateApprovedOvertimeReport(pool: Pool, params: ApprovedOvertimeParams) {
  requireCriteria(params.criteria);
  const { conditions, args } = buildCriteriaConditions(params.criteria, { Units: 'ed.branch_code' });
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT eot.emp_fkey, eot.emp_name, b.branch_name, eot.total_duration, eot.set_duration, eot.is_verified
     FROM emp_ot_master eot
     JOIN emp_details ed ON ed.emp_pkey = eot.emp_fkey
     LEFT JOIN branches b ON b.branch_code = ed.branch_code
     WHERE DATE_FORMAT(eot.month, '%Y-%m') = ? AND eot.is_verified = 'Y' AND ${conditions.join(' AND ')}
     ORDER BY eot.emp_name`,
    [params.monthYear, ...args]
  );
  return rows;
}

export interface CheckinLogsParams {
  fromDate: string;
  toDate: string;
  criteria: CriteriaSelections;
}

// Mirrors generateCheckinlogsReport() — the one report of this batch that's a real date range
// rather than a single month (confirmed via source read).
export async function generateCheckinLogsReport(pool: Pool, params: CheckinLogsParams) {
  requireCriteria(params.criteria);
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'ed.branch_code', EmployeeDetails: 'ed.emp_pkey',
  });
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ed.emp_pkey, CONCAT(ed.first_name, ' ', COALESCE(ed.last_name, '')) AS emp_name,
            b.branch_name, d.dept_name, da.LOGDATE, da.C1 AS status, da.C2 AS device
     FROM device_attandance da
     JOIN emp_details ed ON ed.emp_id = da.emp_id
     LEFT JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
     LEFT JOIN branches b ON b.branch_code = ed.branch_code
     LEFT JOIN department d ON d.dept_code = ep.emp_dept
     WHERE DATE(da.LOGDATE) BETWEEN ? AND ? AND ${conditions.join(' AND ')}
     ORDER BY da.LOGDATE DESC`,
    [params.fromDate, params.toDate, ...args]
  );
  return rows;
}

export interface RegularisationReportParams {
  fromDate: string;
  toDate: string;
  criteria: CriteriaSelections;
}

// Mirrors the 'regularisation' report type — reads the same employee_regularaization table (real
// misspelling) the existing Attendance > Regularisation admin flow writes to.
export async function generateRegularisationReport(pool: Pool, params: RegularisationReportParams) {
  requireCriteria(params.criteria);
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'ed.branch_code', EmployeeDetails: 'ed.emp_pkey',
  });
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ed.emp_pkey, CONCAT(ed.first_name, ' ', COALESCE(ed.last_name, '')) AS emp_name,
            b.branch_name, er.att_date, er.C1 AS direction, er.LOGTIME, er.approved, er.C3 AS remarks
     FROM employee_regularaization er
     JOIN emp_details ed ON ed.emp_id = er.empid
     LEFT JOIN branches b ON b.branch_code = ed.branch_code
     WHERE er.att_date BETWEEN ? AND ? AND er.status = 1 AND ${conditions.join(' AND ')}
     ORDER BY er.att_date DESC`,
    [params.fromDate, params.toDate, ...args]
  );
  return rows;
}
