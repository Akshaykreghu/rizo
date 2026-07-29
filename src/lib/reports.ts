import type { Pool, RowDataPacket } from 'mysql2/promise';

// Ports the shared "dynamic criteria builder" mechanic used across legacy's *ReportsController.php
// files (ReportsController::changereporttype/addreportcriteria/generatereport, mirrored in
// SalaryReportsController/LopReportsController/etc). The live `reportcriterias` table
// (per-company DB) drives which optional filter dimensions are offered for a given report type.
// Confirmed live (both via `SHOW CREATE`/data dumps and a live-instrumented UI walkthrough of
// in.mypayrollmaster.online — see reports/... walkthrough doc): reporttype='employee' ->
// EmployeeProfessionalDetails(joining_date, inactive), Departments(emp_dept), Units(emp_branch),
// EmployeeDetails(emp_pkey). EmployeeProfessionalDetails is also active for 'employee' but is a
// date-range criterion (joining_date), not an enumerable value list — not modeled by the generic
// options-list UI below; left for a follow-up pass. 'shiftpolicy' -> DayTimeProcedures(day_time_seq); 'leavepolicy' ->
// LeavePolicyGroup(LEAVEPOLICY_GROUP_ID); 'holiday' -> HolidayGroup(HOLIDAY_GROUP_ID);
// 'salarystructures' -> SalaryStructures(structure_id); 'SummaryPayroll'/'salary'/'Lop' ->
// EmployeeDetails(emp_pkey), Units(branch_code); 'Grosssalary' -> + Departments/Designation/Gender;
// 'BankTranfer' -> + Banks (a mislabeled/dead criteria row in live data — its
// reportcriteria_field is 'emp_pkey', identical to EmployeeDetails, not an actual bank
// reference — a real legacy data-quality issue, not modeled here since there's nothing coherent
// to filter on).
//
// Deliberate deviation from legacy (functional, not just cosmetic): legacy builds each filter as
// a raw SQL string (`"<alias>.<reportcriteria_field> IN (...)"`, with the alias/column names
// coming straight from the reportcriterias table and the values from request body) and
// concatenates it into the query — a real SQL-injection surface. This port maps each recognized
// criteria name to a fixed, parameterized filter instead; unrecognized criteria are ignored
// rather than trusted blindly.
//
// Per explicit decision, Criteria selection is mandatory here too (matching legacy's real
// behavior — it blocks Preview/Export with `alert("Please Choose Criteria items First")` if no
// criteria value is chosen) — enforced via requireCriteria() below, surfaced as a normal 400 with
// a message instead of a blocking browser alert.

export interface ReportCriteriaRow extends RowDataPacket {
  reportcriteria: string;
  reportcriteria_desc: string;
  reportcriteria_field: string;
}

export type CriteriaSelections = Record<string, string[]>;

export async function getActiveCriteria(pool: Pool, reporttype: string) {
  // DISTINCT: at least one real reporttype ('ESI') has a duplicate EmployeeDetails row in the
  // live table — a data-quality issue, not a second real criteria — dedupe rather than show it
  // twice in the picker.
  const [rows] = await pool.execute<ReportCriteriaRow[]>(
    `SELECT DISTINCT reportcriteria, reportcriteria_desc, reportcriteria_field
     FROM reportcriterias WHERE reporttype = ? AND status = 1`,
    [reporttype]
  );
  return rows;
}

export async function getCriteriaOptions(pool: Pool, reportcriteria: string) {
  switch (reportcriteria) {
    case 'Units': {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT branch_code AS value, branch_name AS label FROM branches WHERE status = 1 ORDER BY branch_name`
      );
      return rows;
    }
    case 'Departments': {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT dept_code AS value, dept_name AS label FROM department WHERE status = 1 ORDER BY dept_name`
      );
      return rows;
    }
    case 'SalaryStructures': {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT structure_id AS value, structure_name AS label FROM salary_structure WHERE structure_active = 1 ORDER BY structure_name`
      );
      return rows;
    }
    case 'Designation': {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT desig_code AS value, desig_name AS label FROM designation WHERE status = 1 ORDER BY desig_name`
      );
      return rows;
    }
    case 'DayTimeProcedures': {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT day_time_seq AS value, day_time_desc AS label FROM working_day_time_procedures ORDER BY day_time_desc`
      );
      return rows;
    }
    case 'LeavePolicyGroup': {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT LEAVEPOLICY_GROUP_ID AS value, LEAVEPOLICY_GROUP_NAME AS label FROM leavepolicy_group WHERE status = 1 ORDER BY LEAVEPOLICY_GROUP_NAME`
      );
      return rows;
    }
    case 'HolidayGroup': {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT HOLIDAY_GROUP_ID AS value, HOLIDAY_GROUP_NAME AS label FROM holiday_group WHERE status = 1 ORDER BY HOLIDAY_GROUP_NAME`
      );
      return rows;
    }
    case 'Gender':
      return [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }];
    default:
      // EmployeeDetails is resolved via the dedicated multi-select checklist
      // (GET /api/reports/employee-options), not a plain options list.
      return [];
  }
}

export interface EmployeeOptionRow extends RowDataPacket {
  value: number;
  label: string;
}

export async function getEmployeeOptions(pool: Pool, search: string, includeResigned: boolean) {
  const statusClause = includeResigned ? `ed.status IN (1,2)` : `ed.status = 1`;
  const args: (string | number)[] = [];
  let searchClause = '';
  if (search) {
    searchClause = `AND (i.EmpName LIKE ? OR i.employee_id LIKE ?)`;
    args.push(`%${search}%`, `%${search}%`);
  }
  const [rows] = await pool.execute<EmployeeOptionRow[]>(
    `SELECT ed.emp_pkey AS value, CONCAT(TRIM(i.EmpName), ' - ', i.employee_id) AS label
     FROM emp_details ed
     LEFT JOIN employee_info i ON i.emp_pkey = ed.emp_pkey
     WHERE ${statusClause} ${searchClause}
     ORDER BY i.EmpName
     LIMIT 500`,
    args
  );
  return rows;
}

export class CriteriaRequiredError extends Error {
  constructor() { super('Please choose at least one criteria value first'); }
}

export function requireCriteria(criteria: CriteriaSelections) {
  const hasAny = Object.values(criteria).some((v) => Array.isArray(v) && v.length > 0);
  if (!hasAny) throw new CriteriaRequiredError();
}

export function buildCriteriaConditions(criteria: CriteriaSelections, fieldMap: Record<string, string>) {
  const conditions: string[] = [];
  const args: (string | number)[] = [];
  for (const [name, values] of Object.entries(criteria)) {
    const col = fieldMap[name];
    if (!col || !values || values.length === 0) continue;
    conditions.push(`${col} IN (${values.map(() => '?').join(',')})`);
    args.push(...values);
  }
  return { conditions, args };
}

export interface EmployeeReportParams {
  subtype: 'employeelist' | 'salarystructure' | 'shiftpolicy' | 'leavepolicy' | 'holiday';
  includeResigned: boolean;
  criteria: CriteriaSelections;
  fields?: string[]; // employeelist only — see EMPLOYEE_FIELD_MAP
}

// The 37-field dual-list column picker on legacy's main "Employee Information" report subtype
// (ReportsController::generateemployeereport). Column mapping confirmed live against the real
// `mypayrol_mpm121` schema — several are legacy misnomers kept as-is on the DB side (`pf` holds
// UAN not provident fund, `branch_name`/`branch_address` on emp_details are the employee's BANK
// branch, not the company branch, `classification` holds gender, `maritual_status`/`guradian` are
// on-disk typos) but given clean, correct labels here. "Area" has no backing column in this
// schema (confirmed absent) — omitted from the picker rather than left silently broken.
// Values are fixed, developer-authored SQL fragments keyed by our own field ids (never raw user
// input), so this is safe to interpolate directly — same discipline as buildCriteriaConditions.
export const EMPLOYEE_FIELD_MAP: Record<string, { label: string; expr: string }> = {
  first_name: { label: 'First Name', expr: 'ed.first_name' },
  middle_name: { label: 'Middle Name', expr: 'ed.middile_name' },
  last_name: { label: 'Last Name', expr: 'ed.last_name' },
  gender: { label: 'Gender', expr: 'ed.classification' },
  address: { label: 'Address', expr: 'ed.address' },
  city: { label: 'City', expr: 'ed.city' },
  state: { label: 'State', expr: 'ed.state' },
  pincode: { label: 'Pincode', expr: 'ed.pincode' },
  mobile_no: { label: 'Mobile No', expr: 'ed.mobile_no' },
  email: { label: 'Email', expr: 'ed.email' },
  marital_status: { label: 'Marital Status', expr: 'ed.maritual_status' },
  education: { label: 'Education', expr: 'ed.education' },
  date_of_birth: { label: 'Date of Birth', expr: 'ed.date_of_birth' },
  bank_name: { label: 'Bank Name', expr: 'ed.bank_name' },
  bank_branch: { label: 'Bank Branch', expr: 'ed.branch_name' },
  bank_branch_address: { label: 'Bank Branch Address', expr: 'ed.branch_address' },
  bank_ifsc: { label: 'Bank IFSC', expr: 'ed.ifsc_code' },
  account_no: { label: 'Account No', expr: 'ed.account_no' },
  pan_no: { label: 'PAN No', expr: 'ed.pan_no' },
  guardian_name: { label: 'Father/Husband Name', expr: 'ed.guradian' },
  relationship: { label: 'Relationship', expr: 'ed.relation_guardian' },
  uan: { label: 'UAN', expr: 'ed.pf' },
  pf_number: { label: 'PF Number', expr: 'ed.company_pf' },
  esi_number: { label: 'ESI Number', expr: 'ed.esi' },
  esi_dispensary: { label: 'ESI Dispensary', expr: 'ed.esi_dispensary' },
  id_aadhaar: { label: 'ID/AADHAAR Number', expr: 'ed.id_card' },
  blood_group: { label: 'Blood Group', expr: 'ed.blood' },
  lwf_reg_number: { label: 'LWF Registration Number', expr: 'ed.lwf_code' },
  company_employee_id: { label: 'Company Employee ID', expr: 'ep.emp_company_id' },
  joining_date: { label: 'Joining Date', expr: 'i.joining_date' },
  employee_type: { label: 'Employee Type', expr: 'ep.emp_type' },
  department: { label: 'Department', expr: 'i.department' },
  grade: { label: 'Grade', expr: 'i.grade' },
  vertical: { label: 'Vertical', expr: 'vt.vertical_name' },
  branch: { label: 'Branch', expr: 'i.branch' },
  designation: { label: 'Designation', expr: 'i.designation' },
  nominee_name: {
    label: 'Nominee Name',
    expr: `(SELECT f.name FROM emp_family f WHERE f.emp_fkey = ed.emp_pkey AND f.is_nominee = 'Y' AND f.status = 1 LIMIT 1)`,
  },
  nominee_relation: {
    label: 'Nominee Relation',
    expr: `(SELECT f.relation FROM emp_family f WHERE f.emp_fkey = ed.emp_pkey AND f.is_nominee = 'Y' AND f.status = 1 LIMIT 1)`,
  },
};

// Mirrors ReportsController::generateemployeereport / generateSalaryStructureReport /
// generateshiftpolicyreport / generateleavepolicyreport / generateholidaypolicyreport.
export async function generateEmployeeReport(pool: Pool, params: EmployeeReportParams) {
  requireCriteria(params.criteria);
  const statusClause = params.includeResigned ? `ed.status IN (1,2)` : `ed.status = 1`;

  if (params.subtype === 'salarystructure') {
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'ep.emp_branch', Departments: 'ep.emp_dept', EmployeeDetails: 'ed.emp_pkey', SalaryStructures: 'ep.structure_id',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT ed.emp_pkey, i.EmpName AS emp_name, i.employee_id, i.branch, i.department, i.designation,
              ss.structure_id, ss.structure_name
       FROM emp_details ed
       JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
       LEFT JOIN employee_info i ON i.emp_pkey = ed.emp_pkey
       LEFT JOIN salary_structure ss ON ss.structure_id = ep.structure_id
       WHERE ${statusClause} AND ep.structure_id IS NOT NULL AND ${conditions.join(' AND ')}
       ORDER BY i.EmpName`,
      args
    );
    return rows;
  }

  if (params.subtype === 'shiftpolicy') {
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'ep.emp_branch', Departments: 'ep.emp_dept', EmployeeDetails: 'ed.emp_pkey', DayTimeProcedures: 'ep.day_time_seq',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT ed.emp_pkey, i.EmpName AS emp_name, i.employee_id, i.branch, i.department,
              wp.day_time_seq, wp.day_time_desc AS shift_policy_name
       FROM emp_details ed
       JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
       LEFT JOIN employee_info i ON i.emp_pkey = ed.emp_pkey
       LEFT JOIN working_day_time_procedures wp ON wp.day_time_seq = ep.day_time_seq
       WHERE ${statusClause} AND ep.day_time_seq IS NOT NULL AND ${conditions.join(' AND ')}
       ORDER BY i.EmpName`,
      args
    );
    return rows;
  }

  if (params.subtype === 'leavepolicy') {
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      EmployeeDetails: 'ed.emp_pkey', LeavePolicyGroup: 'ep.LEAVEPOLICY_GROUP_ID',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT ed.emp_pkey, i.EmpName AS emp_name, i.employee_id, i.branch, i.department,
              lg.LEAVEPOLICY_GROUP_ID, lg.LEAVEPOLICY_GROUP_NAME AS leave_policy_name
       FROM emp_details ed
       JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
       LEFT JOIN employee_info i ON i.emp_pkey = ed.emp_pkey
       LEFT JOIN leavepolicy_group lg ON lg.LEAVEPOLICY_GROUP_ID = ep.LEAVEPOLICY_GROUP_ID
       WHERE ${statusClause} AND ep.LEAVEPOLICY_GROUP_ID IS NOT NULL AND ${conditions.join(' AND ')}
       ORDER BY i.EmpName`,
      args
    );
    return rows;
  }

  if (params.subtype === 'holiday') {
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'ep.emp_branch', EmployeeDetails: 'ed.emp_pkey', HolidayGroup: 'ep.HOLIDAY_GROUP_ID',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT ed.emp_pkey, i.EmpName AS emp_name, i.employee_id, i.branch, i.department,
              hg.HOLIDAY_GROUP_ID, hg.HOLIDAY_GROUP_NAME AS holiday_group_name
       FROM emp_details ed
       JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
       LEFT JOIN employee_info i ON i.emp_pkey = ed.emp_pkey
       LEFT JOIN holiday_group hg ON hg.HOLIDAY_GROUP_ID = ep.HOLIDAY_GROUP_ID
       WHERE ${statusClause} AND ep.HOLIDAY_GROUP_ID IS NOT NULL AND ${conditions.join(' AND ')}
       ORDER BY i.EmpName`,
      args
    );
    return rows;
  }

  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'ep.emp_branch', Departments: 'ep.emp_dept', EmployeeDetails: 'ed.emp_pkey',
  });

  const requestedFields = (params.fields ?? []).filter((f) => f in EMPLOYEE_FIELD_MAP);
  if (requestedFields.length > 0) {
    const selectCols = requestedFields.map((f) => `${EMPLOYEE_FIELD_MAP[f].expr} AS ${f}`).join(', ');
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT ed.emp_pkey, i.EmpName AS emp_name, i.employee_id, ${selectCols}
       FROM emp_details ed
       JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
       LEFT JOIN employee_info i ON i.emp_pkey = ed.emp_pkey
       LEFT JOIN verticals vt ON vt.vert_code = ep.emp_vertical
       WHERE ${statusClause} AND ${conditions.join(' AND ')}
       ORDER BY i.EmpName`,
      args
    );
    return rows;
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ed.emp_pkey, i.EmpName AS emp_name, i.employee_id, i.branch, i.department, i.designation,
            i.joining_date, i.grade, ed.mobile_no, ed.email, ed.status
     FROM emp_details ed
     JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
     LEFT JOIN employee_info i ON i.emp_pkey = ed.emp_pkey
     WHERE ${statusClause} AND ${conditions.join(' AND ')}
     ORDER BY i.EmpName`,
    args
  );
  return rows;
}

// `emp_salary_slip` is versioned exactly like `emp_ctc_transaction` — every payroll
// reprocess/re-approve leaves the prior batch's rows in place and inserts a fresh batch, so a
// naive `WHERE payroll_master_fkey = X` (or `month_year = X`) over-counts by the number of
// reprocess cycles (confirmed live: 3x duplicate rows on a payroll row reprocessed twice). Every
// query below that touches `emp_salary_slip` filters `end_date_effective IS NULL` to get only the
// current batch.
//
// Deliberately not ported (of the 15 real Payroll Report subtypes): BankTranferNew (confirmed via
// source read to be a cosmetic grouping variant of BankTranfer, same underlying data — not a
// distinct report), salarystructure/"CTC Detail" and SalaryCombined (both pull from
// emp_salary_structure/emp_variable_pay_upload — real but lower-value config-listing reports, not
// yet built), Account/"Salary Account" (legacy's own Financial-Year mode is dead/commented-out
// code — confirmed live behavior is Monthly-only regardless of the report_type toggle — and its
// Monthly mode substantially overlaps PayrollCTC/SummaryPayroll; deferred rather than building a
// near-duplicate).
export interface PayrollReportParams {
  subtype: 'SummaryPayroll' | 'salary' | 'Grosssalary' | 'BankTranfer' | 'Salaryslip'
    | 'MonthlyCTCReport' | 'PayrollCTC' | 'GrosssalaryNew' | 'Comparison' | 'GrosssalarySummary' | 'GrossPeriod';
  monthYear: string; // 'YYYY-MM' — used by all subtypes except GrossPeriod
  toMonthYear?: string; // 'YYYY-MM' — GrossPeriod only, range end (monthYear is the range start)
  criteria: CriteriaSelections;
}

function prevMonth(monthYear: string): string {
  const [y, m] = monthYear.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Legacy's Grosssalary/GrosssalaryNew/PayrollCTC/Comparison views all pivot each employee's real
// salary-head items (Basic, HRA, Conveyance, etc — varies per company/employee) into their own
// columns, alongside the fixed aggregate totals already ported. Fetches the Addition-side items
// actually processed this month from `emp_salary_slip` (the same source the aggregate
// standard/variable totals already draw from via head_pkey category — this is that same data at
// per-item grain instead of summed). Deliberately does NOT also pivot a parallel "Standard Salary"
// (structure-value) column set the way legacy's HTML does — that pulls from a different source
// (emp_ctc_transaction/emp_salary_structure) and would double the column count for a lower-value
// planned-vs-actual distinction; documented simplification, not silently dropped.
async function getItemWiseAdditions(pool: Pool, payrollMasterPkeys: number[]): Promise<Map<number, SalarySlipLineItem[]>> {
  const map = new Map<number, SalarySlipLineItem[]>();
  if (payrollMasterPkeys.length === 0) return map;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ess.payroll_master_fkey, ess.salary_head_item_desc, ess.salary_amount, ess.structure_det_value
     FROM emp_salary_slip ess
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
     WHERE ess.payroll_master_fkey IN (?) AND ess.item_part = 'Direct' AND ess.head_operator = 'Addition'
       AND ess.end_date_effective IS NULL
     ORDER BY shi.salary_head_item_order1`,
    [payrollMasterPkeys]
  );
  for (const r of rows as RowDataPacket[]) {
    const list = map.get(r.payroll_master_fkey) ?? [];
    list.push({
      label: String(r.salary_head_item_desc).trim(),
      amount: Math.round(Number(r.salary_amount)),
      rate: Math.round(Number(r.structure_det_value ?? r.salary_amount)),
    });
    map.set(r.payroll_master_fkey, list);
  }
  return map;
}

// Mirrors SalaryReportsController::GenerateSummaryPayrolreport and sibling generate<X>report
// methods for the other report-type variants on the same "Salary" screen.
export async function generatePayrollReport(pool: Pool, params: PayrollReportParams) {
  requireCriteria(params.criteria);

  if (params.subtype === 'salary') {
    // CTC Summary — the employee's currently-open CTC row (end_date_effective IS NULL),
    // matching the convention already used by src/lib/increments.ts.
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'ep.emp_branch', EmployeeDetails: 'ed.emp_pkey',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT ed.emp_pkey, i.EmpName AS emp_name, ep.emp_company_id AS employee_id, i.branch, i.department, i.designation,
              i.joining_date, tm.last_approved_working_date AS termination_date,
              ct.emp_anual_ctc, ct.emp_derived_anualctc, ct.start_date_effective, ct.next_increment_date
       FROM emp_details ed
       JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
       JOIN emp_ctc_transaction ct ON ct.emp_fkey = ed.emp_pkey AND ct.end_date_effective IS NULL
       LEFT JOIN employee_info i ON i.emp_pkey = ed.emp_pkey
       LEFT JOIN termination tm ON tm.emp_fkey = ed.emp_pkey AND tm.status = 1
       WHERE ed.status = 1 AND ${conditions.join(' AND ')}
       ORDER BY i.EmpName`,
      args
    );
    return rows;
  }

  if (params.subtype === 'Grosssalary') {
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey', Departments: 'ep.emp_dept',
      Designation: 'ep.designation', Gender: 'ed.classification',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.payroll_master_pkey, pm.emp_fkey, pm.emp_name, ep.emp_company_id AS employee_id, pm.branch_name,
              pm.departments, pm.desig, pm.month_year,
              i.joining_date, tm.last_approved_working_date AS termination_date,
              pm.days_presant, pm.loss_of_pay, pm.days_leave, ar.weekoff_total, ar.holiday_total,
              COALESCE(ot.set_duration, 0) AS overtime_hours,
              pm.gross_salary, pm.total_deduction, pm.total_variables, pm.net_salary
       FROM payroll_master pm
       JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
       JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
       LEFT JOIN employee_info i ON i.emp_pkey = pm.emp_fkey
       LEFT JOIN termination tm ON tm.emp_fkey = pm.emp_fkey AND tm.status = 1
       LEFT JOIN attendance_register ar ON ar.emp_fkey = pm.emp_fkey AND ar.month_year = pm.month_year
       LEFT JOIN emp_ot_master ot ON ot.emp_fkey = pm.emp_fkey AND DATE_FORMAT(ot.month, '%Y-%m') = pm.month_year AND ot.is_verified = 'Y'
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
       ORDER BY pm.emp_name`,
      [params.monthYear, ...args]
    );
    const itemMap = await getItemWiseAdditions(pool, rows.map((r) => r.payroll_master_pkey));
    return rows.map((row) => ({ ...row, items: itemMap.get(row.payroll_master_pkey) ?? [] }));
  }

  if (params.subtype === 'BankTranfer') {
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.emp_fkey, pm.emp_name, ep.emp_company_id AS employee_id, pm.branch_name,
              pm.departments, pm.desig, pm.month_year,
              i.joining_date, tm.last_approved_working_date AS termination_date,
              pm.bank_details, ed.bank_name AS ed_bank_name, ed.branch_name AS ed_bank_branch,
              ed.ifsc_code AS ed_ifsc_code, ed.account_no AS ed_account_no, pm.net_salary
       FROM payroll_master pm
       JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
       LEFT JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
       LEFT JOIN employee_info i ON i.emp_pkey = pm.emp_fkey
       LEFT JOIN termination tm ON tm.emp_fkey = pm.emp_fkey AND tm.status = 1
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
       ORDER BY pm.emp_name`,
      [params.monthYear, ...args]
    );
    // Bank details snapshot (comma-separated: bank_name,branch_name,ifsc_code,acc_number) taken at
    // payroll-process time, falling back to the employee's current emp_details bank fields if
    // blank — same fallback legacy uses (matches generateSalarySlips' bank resolution).
    return rows.map((row) => {
      let [bankName, bankBranch, ifscCode, accountNo] = row.bank_details ? String(row.bank_details).split(',') : ['', '', '', ''];
      bankName = bankName || row.ed_bank_name || '';
      bankBranch = bankBranch || row.ed_bank_branch || '';
      ifscCode = ifscCode || row.ed_ifsc_code || '';
      accountNo = accountNo || row.ed_account_no || '';
      return { ...row, bank_name: bankName, bank_branch: bankBranch, ifsc_code: ifscCode, account_no: accountNo };
    });
  }

  if (params.subtype === 'Salaryslip') {
    return generateSalarySlips(pool, params);
  }

  if (params.subtype === 'GrosssalaryNew') {
    // Mirrors GenerateSalaryGrossNewNotExempted() — identical source to Grosssalary, plus a
    // Standard-vs-Variable split of the Addition heads (salary_heads.head_pkey 1,5 = standard;
    // 2,7,9 = variable — confirmed live via emp_salary_slip/salary_head_items/salary_heads).
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey', Departments: 'ep.emp_dept',
      Designation: 'ep.designation', Gender: 'ed.classification',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.payroll_master_pkey, pm.emp_fkey, pm.emp_name, ep.emp_company_id AS employee_id, pm.branch_name,
              pm.departments, pm.desig, pm.month_year,
              i.joining_date, tm.last_approved_working_date AS termination_date,
              pm.days_presant, pm.loss_of_pay, pm.days_leave, ar.weekoff_total, ar.holiday_total,
              COALESCE(ot.set_duration, 0) AS overtime_hours,
              pm.gross_salary, pm.total_deduction, pm.net_salary,
              COALESCE((SELECT SUM(ess.salary_amount) FROM emp_salary_slip ess
                        JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
                        WHERE ess.payroll_master_fkey = pm.payroll_master_pkey AND ess.end_date_effective IS NULL
                          AND shi.head_fkey IN (1,5)), 0) AS standard_total,
              COALESCE((SELECT SUM(ess.salary_amount) FROM emp_salary_slip ess
                        JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
                        WHERE ess.payroll_master_fkey = pm.payroll_master_pkey AND ess.end_date_effective IS NULL
                          AND shi.head_fkey IN (2,7,9)), 0) AS variable_total
       FROM payroll_master pm
       JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
       JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
       LEFT JOIN employee_info i ON i.emp_pkey = pm.emp_fkey
       LEFT JOIN termination tm ON tm.emp_fkey = pm.emp_fkey AND tm.status = 1
       LEFT JOIN attendance_register ar ON ar.emp_fkey = pm.emp_fkey AND ar.month_year = pm.month_year
       LEFT JOIN emp_ot_master ot ON ot.emp_fkey = pm.emp_fkey AND DATE_FORMAT(ot.month, '%Y-%m') = pm.month_year AND ot.is_verified = 'Y'
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
       ORDER BY pm.emp_name`,
      [params.monthYear, ...args]
    );
    const itemMap = await getItemWiseAdditions(pool, rows.map((r) => r.payroll_master_pkey));
    return rows.map((row) => ({ ...row, items: itemMap.get(row.payroll_master_pkey) ?? [] }));
  }

  if (params.subtype === 'GrosssalarySummary') {
    // Mirrors GenerateSalaryGrossSummary() — a branch-level aggregation rather than a per-employee
    // row (the "Summary" distinction from Grosssalary's per-employee detail) — this was WRONG.
    // Read the real legacy view (grosssummaryreport.ctp) directly: despite the name, it's an
    // employee-level detail list grouped by branch (same row granularity as Grosssalary), not a
    // branch-totals aggregate. Confirmed via a dedicated column-audit pass and fixed per explicit
    // user decision to match legacy exactly rather than keep the (arguably more useful, but not
    // what this report actually is) aggregate version.
    const { conditions, args } = buildCriteriaConditions(params.criteria, { Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey' });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.emp_fkey, pm.emp_name, ep.emp_company_id AS employee_id, pm.branch_name,
              pm.departments, pm.desig, pm.month_year,
              pm.days_presant, pm.loss_of_pay, pm.days_leave, ar.weekoff_total, ar.holiday_total,
              pm.gross_salary, pm.total_deduction, pm.net_salary
       FROM payroll_master pm
       JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
       LEFT JOIN attendance_register ar ON ar.emp_fkey = pm.emp_fkey AND ar.month_year = pm.month_year
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
       ORDER BY pm.branch_name, pm.emp_name`,
      [params.monthYear, ...args]
    );
    return rows;
  }

  if (params.subtype === 'GrossPeriod') {
    // Mirrors GenerateSalaryGrossPeriod() — the only true date-range (not single-month) variant
    // on this screen. payroll_master.month_year is 'YYYY-MM', which sorts correctly lexically.
    const toMonth = params.toMonthYear ?? params.monthYear;
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.emp_fkey, pm.emp_name, ep.emp_company_id AS employee_id, pm.branch_name,
              pm.departments, pm.desig, pm.month_year,
              i.joining_date, tm.last_approved_working_date AS termination_date,
              ed.classification AS gender, pm.days_presant,
              pm.gross_salary, pm.total_deduction, pm.net_salary
       FROM payroll_master pm
       LEFT JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
       LEFT JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
       LEFT JOIN employee_info i ON i.emp_pkey = pm.emp_fkey
       LEFT JOIN termination tm ON tm.emp_fkey = pm.emp_fkey AND tm.status = 1
       WHERE pm.month_year BETWEEN ? AND ? AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
       ORDER BY pm.emp_name, pm.month_year`,
      [params.monthYear, toMonth, ...args]
    );
    return rows;
  }

  if (params.subtype === 'Comparison') {
    // Mirrors GenerateSalaryComparison() — compares the selected month against the prior
    // calendar month, computed server-side (legacy: DateTime::modify('-1 month')), not a
    // user-picked second date. Legacy's real comparison_report.ctp compares ~10 metric groups
    // (CTC Standard/Actual, Gross Salary Standard/Actual, per-salary-head amounts, Pay Days,
    // Variable Additions/Deductions counts, Bank Account) as prev/current/diff triplets — this
    // port covers the metrics directly available as payroll_master columns (CTC, Gross Salary,
    // Total Deduction, Net Salary, Pay Days), each as prev/current/diff. Per-salary-head dynamic
    // comparison columns (a pivoted column per distinct salary head company-wide) and the
    // Variable Additions/Deductions Count / Bank Account comparisons are NOT built — those would
    // need a genuinely different data source (counts of variable-pay upload rows; a bank-account
    // string diff) unrelated to the salary-head pivot below, so they're flagged here as a real,
    // smaller follow-up rather than silently claimed as done. Per-salary-head prev/current/diff
    // IS built below (`items`), reusing `getItemWiseAdditions()` for both months and merging by
    // label — the one dynamic-pivot piece this report genuinely needed.
    const prior = prevMonth(params.monthYear);
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.payroll_master_pkey, prev.payroll_master_pkey AS prev_payroll_master_pkey,
              pm.emp_fkey, pm.emp_name, ep.emp_company_id AS employee_id, pm.branch_name,
              pm.departments, pm.desig, ed.status,
              i.joining_date, tm.last_approved_working_date AS termination_date,
              pm.gross_salary AS current_gross, prev.gross_salary AS previous_gross,
              (pm.gross_salary - COALESCE(prev.gross_salary, 0)) AS gross_change,
              pm.total_deduction AS current_deduction, prev.total_deduction AS previous_deduction,
              (pm.total_deduction - COALESCE(prev.total_deduction, 0)) AS deduction_change,
              pm.net_salary AS current_net, prev.net_salary AS previous_net,
              (pm.net_salary - COALESCE(prev.net_salary, 0)) AS net_change,
              pm.monthly_ctc AS current_ctc, prev.monthly_ctc AS previous_ctc,
              (pm.monthly_ctc - COALESCE(prev.monthly_ctc, 0)) AS ctc_change,
              pm.days_presant AS current_pay_days, prev.days_presant AS previous_pay_days,
              (pm.days_presant - COALESCE(prev.days_presant, 0)) AS pay_days_change
       FROM payroll_master pm
       LEFT JOIN payroll_master prev ON prev.emp_fkey = pm.emp_fkey AND prev.month_year = ?
         AND prev.action IN ('Approved','Processed')
       LEFT JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
       LEFT JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
       LEFT JOIN employee_info i ON i.emp_pkey = pm.emp_fkey
       LEFT JOIN termination tm ON tm.emp_fkey = pm.emp_fkey AND tm.status = 1
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
       ORDER BY pm.emp_name`,
      [prior, params.monthYear, ...args]
    );

    const currentItems = await getItemWiseAdditions(pool, rows.map((r) => r.payroll_master_pkey));
    const prevItems = await getItemWiseAdditions(pool, rows.filter((r) => r.prev_payroll_master_pkey).map((r) => r.prev_payroll_master_pkey));

    return rows.map((row) => {
      const curr = currentItems.get(row.payroll_master_pkey) ?? [];
      const prev = prevItems.get(row.prev_payroll_master_pkey) ?? [];
      const labels: string[] = [];
      for (const item of curr) if (!labels.includes(item.label)) labels.push(item.label);
      for (const item of prev) if (!labels.includes(item.label)) labels.push(item.label);
      const items = labels.map((label) => {
        const currentAmount = curr.find((i) => i.label === label)?.amount ?? 0;
        const previousAmount = prev.find((i) => i.label === label)?.amount ?? 0;
        return { label, current: currentAmount, previous: previousAmount, change: currentAmount - previousAmount };
      });
      return { ...row, items };
    });
  }

  if (params.subtype === 'MonthlyCTCReport') {
    // Mirrors generateEmpMonthlyCTCReport() — per-employee, per-salary-head-item detail (a long
    // format breakdown, not a pivoted summary), sourced from emp_salary_slip.
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.emp_fkey, pm.emp_name, ep.emp_company_id AS employee_id, pm.branch_name,
              pm.departments, pm.desig, pm.month_year,
              shi.item AS salary_head, ess.salary_amount
       FROM emp_salary_slip ess
       JOIN payroll_master pm ON pm.payroll_master_pkey = ess.payroll_master_fkey
       JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
       LEFT JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
       WHERE ess.month_year = ? AND ess.end_date_effective IS NULL
         AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
       ORDER BY pm.emp_name, shi.salary_head_item_order1`,
      [params.monthYear, ...args]
    );
    return rows;
  }

  if (params.subtype === 'PayrollCTC') {
    // Mirrors generatePayrollCTC() — the most granular CTC breakdown of the module: per-employee
    // totals categorized by salary_heads.head_pkey (1,5=Standard; 2,7,9=Variable; 4=Employer
    // Contributions; everything else=Other/Ad-hoc), confirmed live via real emp_salary_slip data.
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT MAX(pm.payroll_master_pkey) AS payroll_master_pkey, pm.emp_fkey, pm.emp_name, ep.emp_company_id AS employee_id, pm.branch_name,
              pm.departments, pm.desig, pm.month_year, ed.classification AS gender,
              MAX(pm.days_presant) AS present_days, MAX(pm.loss_of_pay) AS lop_days, MAX(pm.days_leave) AS leave_days,
              MAX(ar.weekoff_total) AS weekoff_total, MAX(ar.holiday_total) AS holiday_total,
              COALESCE(SUM(CASE WHEN sh.head_pkey IN (1,5) THEN ess.salary_amount END), 0) AS standard_total,
              COALESCE(SUM(CASE WHEN sh.head_pkey IN (2,7,9) THEN ess.salary_amount END), 0) AS variable_total,
              COALESCE(SUM(CASE WHEN sh.head_pkey = 4 THEN ess.salary_amount END), 0) AS employer_total,
              COALESCE(SUM(CASE WHEN sh.head_pkey NOT IN (1,2,4,5,7,9) THEN ess.salary_amount END), 0) AS other_total,
              MAX(pm.total_deduction) AS total_deduction, MAX(pm.net_salary) AS net_salary
       FROM emp_salary_slip ess
       JOIN payroll_master pm ON pm.payroll_master_pkey = ess.payroll_master_fkey
       JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
       JOIN salary_heads sh ON sh.head_pkey = shi.head_fkey
       LEFT JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
       LEFT JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
       LEFT JOIN attendance_register ar ON ar.emp_fkey = pm.emp_fkey AND ar.month_year = pm.month_year
       WHERE ess.month_year = ? AND ess.end_date_effective IS NULL
         AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
       GROUP BY pm.emp_fkey, pm.emp_name, ep.emp_company_id, pm.branch_name, pm.departments, pm.desig, pm.month_year, ed.classification
       ORDER BY pm.emp_name`,
      [params.monthYear, ...args]
    );
    const itemMap = await getItemWiseAdditions(pool, rows.map((r) => r.payroll_master_pkey));
    return rows.map((row) => ({ ...row, items: itemMap.get(row.payroll_master_pkey) ?? [] }));
  }

  // SummaryPayroll (default)
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
  });
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT pm.emp_fkey, pm.emp_name, ep.emp_company_id AS employee_id, pm.branch_name,
            pm.departments, pm.desig, pm.month_year,
            i.joining_date, tm.last_approved_working_date AS termination_date,
            pm.days_presant, pm.days_leave, pm.loss_of_pay, pm.working_days, ar.weekoff_total, ar.holiday_total,
            pm.monthly_ctc, pm.gross_salary, pm.total_deduction, pm.total_variables, pm.net_salary, pm.approved
     FROM payroll_master pm
     LEFT JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
     LEFT JOIN employee_info i ON i.emp_pkey = pm.emp_fkey
     LEFT JOIN termination tm ON tm.emp_fkey = pm.emp_fkey AND tm.status = 1
     LEFT JOIN attendance_register ar ON ar.emp_fkey = pm.emp_fkey AND ar.month_year = pm.month_year
     WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
     ORDER BY pm.emp_name`,
    [params.monthYear, ...args]
  );
  return rows;
}

export interface SalarySlipLineItem {
  label: string;
  amount: number;
  rate: number;
}

export interface SalarySlip {
  emp_pkey: number;
  emp_name: string;
  employee_id: string | null;
  login_user_id: string | null;
  designation: string | null;
  department: string | null;
  branch_name: string | null;
  joining_date: string | null;
  termination_date: string | null;
  gender: string | null;
  status: number;
  leave_days: number;
  present_days: number;
  lop_days: number;
  weekoff_days: number;
  holiday_days: number;
  pf_account_no: string | null;
  esi_no: string | null;
  uan_no: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  ifsc_code: string | null;
  account_no: string | null;
  earnings: SalarySlipLineItem[];
  deductions: SalarySlipLineItem[];
  total_earnings: number;
  total_deductions: number;
  net_pay: number;
}

// Mirrors View/SalaryReports/salaryslip.ctp — legacy renders this as a formatted payslip document
// per employee (header block with designation/branch, a details grid of leave/attendance/PF/ESI/
// bank info, then a two-column Earnings/Deductions table with Net Pay), NOT a generic results grid
// like every other Payroll Report subtype. The first port of this subtype returned a flat
// payroll_master summary row rendered through the same generic table as everything else — a real
// gap flagged directly by the user after checking it against the legacy screen. Fixed by returning
// a distinct, structured shape (this interface) that the frontend renders as payslip cards instead.
export async function generateSalarySlips(pool: Pool, params: PayrollReportParams): Promise<SalarySlip[]> {
  requireCriteria(params.criteria);
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
  });

  const [headerRows] = await pool.execute<RowDataPacket[]>(
    `SELECT pm.payroll_master_pkey, pm.emp_fkey, i.EmpName AS emp_name, i.designation, i.department,
            i.branch AS branch_name, i.joining_date, ed.status, ed.classification AS gender,
            pm.days_leave, pm.loss_of_pay, pm.bank_details,
            ar.presant_total, ar.weekoff_total, ar.holiday_total,
            ed.company_pf, ed.esi, ed.pf AS uan,
            ed.bank_name AS ed_bank_name, ed.branch_name AS ed_bank_branch, ed.ifsc_code AS ed_ifsc_code,
            ed.account_no AS ed_account_no,
            ep.emp_company_id AS employee_id, uc.user_id AS login_user_id, tm.last_approved_working_date AS termination_date
     FROM payroll_master pm
     JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
     LEFT JOIN employee_info i ON i.emp_pkey = pm.emp_fkey
     LEFT JOIN attendance_register ar ON ar.emp_fkey = pm.emp_fkey AND ar.month_year = pm.month_year
     LEFT JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
     LEFT JOIN user_credentials uc ON uc.emp_fkey = pm.emp_fkey
     LEFT JOIN termination tm ON tm.emp_fkey = pm.emp_fkey AND tm.status = 1
     WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
     ORDER BY i.EmpName`,
    [params.monthYear, ...args]
  );

  if (headerRows.length === 0) return [];

  const payrollPkeys = headerRows.map((r) => r.payroll_master_pkey);
  const [lineItems] = await pool.query<RowDataPacket[]>(
    `SELECT ess.payroll_master_fkey, ess.head_operator, ess.salary_amount, ess.structure_det_value, ess.salary_head_item_desc
     FROM emp_salary_slip ess
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
     WHERE ess.payroll_master_fkey IN (?) AND ess.item_part = 'Direct' AND ess.end_date_effective IS NULL
     ORDER BY shi.salary_head_item_order1`,
    [payrollPkeys]
  );

  const itemsByPayroll = new Map<number, RowDataPacket[]>();
  for (const item of lineItems as RowDataPacket[]) {
    const list = itemsByPayroll.get(item.payroll_master_fkey) ?? [];
    list.push(item);
    itemsByPayroll.set(item.payroll_master_fkey, list);
  }

  return (headerRows as RowDataPacket[]).map((row) => {
    // Bank details come from payroll_master's snapshot at process time (comma-separated:
    // bank_name,branch_name,ifsc_code,acc_number), falling back to the employee's current
    // emp_details bank fields if that snapshot is blank — matching legacy's fallback exactly.
    let bankName = '', bankBranch = '', ifscCode = '', accountNo = '';
    if (row.bank_details) {
      const parts = String(row.bank_details).split(',');
      [bankName, bankBranch, ifscCode, accountNo] = parts;
    }
    bankName = bankName || row.ed_bank_name || '';
    bankBranch = bankBranch || row.ed_bank_branch || '';
    ifscCode = ifscCode || row.ed_ifsc_code || '';
    accountNo = accountNo || row.ed_account_no || '';

    const items = itemsByPayroll.get(row.payroll_master_pkey) ?? [];
    const earnings: SalarySlipLineItem[] = [];
    const deductions: SalarySlipLineItem[] = [];
    for (const item of items) {
      const line = {
        label: String(item.salary_head_item_desc).trim(),
        amount: Math.abs(Math.round(Number(item.salary_amount))),
        rate: Math.abs(Math.round(Number(item.structure_det_value ?? item.salary_amount))),
      };
      if (item.head_operator === 'Addition') earnings.push(line);
      else deductions.push(line);
    }
    const totalEarnings = earnings.reduce((s, e) => s + e.amount, 0);
    const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0);

    return {
      emp_pkey: row.emp_fkey,
      emp_name: (row.emp_name ?? '').trim(),
      employee_id: row.employee_id,
      login_user_id: row.login_user_id,
      designation: row.designation,
      department: row.department,
      branch_name: row.branch_name,
      joining_date: row.joining_date,
      termination_date: row.termination_date,
      gender: row.gender ? String(row.gender).toUpperCase() : null,
      status: row.status,
      leave_days: row.days_leave ?? 0,
      present_days: row.presant_total ?? 0,
      lop_days: row.loss_of_pay ?? 0,
      weekoff_days: row.weekoff_total ?? 0,
      holiday_days: row.holiday_total ?? 0,
      pf_account_no: row.company_pf,
      esi_no: row.esi,
      uan_no: row.uan,
      bank_name: bankName,
      bank_branch: bankBranch,
      ifsc_code: ifscCode,
      account_no: accountNo,
      earnings,
      deductions,
      total_earnings: totalEarnings,
      total_deductions: totalDeductions,
      net_pay: totalEarnings - totalDeductions,
    };
  });
}

export interface LopReportParams {
  fromDate: string;
  toDate: string;
  criteria: CriteriaSelections;
}

// Mirrors LopReportsController::generatelopreport.
export async function generateLopReport(pool: Pool, params: LopReportParams) {
  requireCriteria(params.criteria);
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'i.branch_code', EmployeeDetails: 'ed.emp_pkey',
  });

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ed.emp_pkey, i.EmpName AS emp_name, i.employee_id, i.branch, i.department, i.designation,
            t.att_date, t.others, t.leaves, tm.last_approved_working_date
     FROM emp_details ed
     JOIN emp_detail_timeattandance t ON t.emp_pkey = ed.emp_pkey
     LEFT JOIN employee_info i ON i.emp_pkey = ed.emp_pkey
     LEFT JOIN termination tm ON tm.emp_fkey = ed.emp_pkey AND tm.status = 1
     WHERE ed.status IN (1,2)
       AND (t.others = 'LOP' OR (t.leaves = 'LOP/LOP' AND t.weekoff IS NULL))
       AND t.att_date BETWEEN ? AND ?
       AND ${conditions.join(' AND ')}
     ORDER BY t.att_date, i.EmpName`,
    [params.fromDate, params.toDate, ...args]
  );
  return rows;
}
