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
// 'BankTranfer' -> EmployeeDetails, Units, LeavePolicyGroup, Banks. LeavePolicyGroup here is
// legacy's mislabeled "belonging to a Bank" criteria (reportcriteria_field is 'emp_pkey', same as
// EmployeeDetails, but that field is never actually used for this report) — legacy's own
// listcriteriaitems() (SalaryReportsController.php:498-499, 583-639) redirects BOTH
// 'LeavePolicyGroup' and 'Banks' under this report type to the exact same distinct-bank-name list
// (IFNULL(SUBSTRING_INDEX(bank_details,',',1), bank_name) from payroll_master ∪ emp_details.bank_name).
// 'Banks' additionally switches the whole report into a different "Bank Statement" output shape —
// see the BankTranfer branch below and SUBTYPE_META.BankTranfer in page.tsx.
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

// Distinct bank names for BankTranfer's LeavePolicyGroup/Banks criteria (see the comment above the
// imports) — mirrors legacy's listcriteriaitems() query exactly, including the payroll_master ∪
// emp_details union and blank-name exclusion.
async function getBankNameOptions(pool: Pool) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT bank_name AS value, bank_name AS label FROM (
       SELECT DISTINCT IFNULL(SUBSTRING_INDEX(pm.bank_details, ',', 1), ed.bank_name) AS bank_name
       FROM payroll_master pm
       INNER JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
       UNION
       SELECT DISTINCT bank_name FROM emp_details WHERE status IN ('1', '2')
     ) b
     WHERE bank_name IS NOT NULL AND bank_name <> ''
     ORDER BY bank_name`
  );
  return rows;
}

export async function getCriteriaOptions(pool: Pool, reportcriteria: string, reportType?: string) {
  if (reportType === 'BankTranfer' && (reportcriteria === 'LeavePolicyGroup' || reportcriteria === 'Banks')) {
    return getBankNameOptions(pool);
  }
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
    case 'LeaveType': {
      // Every leave type actually referenced by an active leave policy — same "belonging to a Leave
      // Type" set legacy's own listcriteriaitems() resolves for this criteria (LeaveRequest
      // criteria block, LEAVEPOLICY join), not every salary_head_items row.
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT DISTINCT shi.salary_head_item_pkey AS value, shi.item AS label
         FROM salary_head_items shi JOIN leavepolicy lp ON lp.salary_head_item_fkey = shi.salary_head_item_pkey
         WHERE lp.status = 1
         ORDER BY shi.item`
      );
      return rows;
    }
    case 'Leavestatus': {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT LEAVESTATUS AS value, LEAVESTATUS AS label FROM leavestatus ORDER BY LEAVESTATUS`
      );
      return rows;
    }
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
  date_of_birth: { label: 'Date of Birth', expr: "DATE_FORMAT(ed.date_of_birth, '%Y-%m-%d')" },
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
  joining_date: { label: 'Joining Date', expr: "DATE_FORMAT(i.joining_date, '%Y-%m-%d')" },
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
            DATE_FORMAT(i.joining_date, '%Y-%m-%d') AS joining_date, i.grade, ed.mobile_no, ed.email, ed.status
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
  includeResigned?: boolean; // SummaryPayroll/salary/Grosssalary/BankTranfer/GrosssalaryNew/GrosssalarySummary/GrossPeriod/Comparison/MonthlyCTCReport/PayrollCTC — "Include Resigned" checkbox
  includeNegative?: boolean; // SummaryPayroll/Grosssalary/BankTranfer/GrosssalaryNew/GrosssalarySummary/GrossPeriod/Comparison/MonthlyCTCReport/PayrollCTC — "Include Negative Salary" checkbox
}

function prevMonth(monthYear: string): string {
  const [y, m] = monthYear.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Salary Previous Month Comparison's own "Standard Addition" item pivot (SalaryReportsController.php:
// 18109-18120, 18336-18348) — structure_det_value (not salary_amount), restricted to
// salary_heads.head_fkey IN (1,4,5), with NO item_part
// filter at all, and ONE value per employee per label per month (legacy takes the first/only DISTINCT
// row, not a sum — these head categories don't repeat per employee in practice). The column label set
// is the union of labels appearing in EITHER month (legacy's `arr_items`), not just this employee's
// own labels, so every row gets the same zero-filled column set.
async function getComparisonItemLabels(pool: Pool, monthA: string, monthB: string): Promise<string[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT DISTINCT TRIM(ess.salary_head_item_desc) AS label, shi.salary_head_item_order1 AS ord
     FROM emp_salary_slip ess
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
     WHERE ess.end_date_effective IS NULL AND ess.month_year IN (?, ?)
       AND shi.head_fkey IN (1,4,5) AND ess.structure_det_value IS NOT NULL AND ess.structure_det_value <> 0
     ORDER BY ord`,
    [monthA, monthB]
  );
  return (rows as RowDataPacket[]).map((r) => String(r.label));
}

async function getComparisonItemValues(pool: Pool, empFkeys: number[], month: string): Promise<Map<number, Map<string, number>>> {
  const map = new Map<number, Map<string, number>>();
  if (empFkeys.length === 0) return map;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ess.emp_fkey, TRIM(ess.salary_head_item_desc) AS label, MAX(ess.structure_det_value) AS value
     FROM emp_salary_slip ess
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
     WHERE ess.emp_fkey IN (?) AND ess.end_date_effective IS NULL AND ess.month_year = ?
       AND shi.head_fkey IN (1,4,5)
     GROUP BY ess.emp_fkey, ess.salary_head_item_desc`,
    [empFkeys, month]
  );
  for (const r of rows as RowDataPacket[]) {
    let m = map.get(r.emp_fkey);
    if (!m) { m = new Map(); map.set(r.emp_fkey, m); }
    m.set(String(r.label), Number(r.value));
  }
  return map;
}

// Salary Previous Month Comparison's Pay Days is NOT payroll_master.days_presant — legacy computes
// it per a company-wide attendance policy read off emp_salary_structure.prorate_code (getprodataDesc,
// SalaryReportsController.php:12826-12868, as actually consumed by comparison_report.ctp:298-332):
//   - '1' (Calendar Days, the default when no structure row exists) — attendance_register's
//     presant_total + leave_total + holiday_total + weekoff_total for that employee+month.
//   - '2' (Working Days) — (payroll_master.days_presant + payroll_master.days_leave) +
//     emp_salary_slip.leave_total (the view adds this on top of getprodataDesc's own present figure,
//     which already includes days_leave once — legacy double-counts leave here; replicated as-is).
//   - anything else (Fixed Days) — a flat 30, regardless of any actual attendance data.
// prorate_code itself isn't month-specific, so one lookup per employee covers both months being
// compared.
async function getProrateCodes(pool: Pool, empFkeys: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (empFkeys.length === 0) return map;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT emp_fkey, prorate_code FROM emp_salary_structure WHERE emp_fkey IN (?) AND end_date_effective IS NULL`,
    [empFkeys]
  );
  for (const r of rows as RowDataPacket[]) {
    if (!map.has(r.emp_fkey)) map.set(r.emp_fkey, r.prorate_code != null ? String(r.prorate_code) : '1');
  }
  return map;
}

interface PayDaysInputs { arPresent: number; arLeave: number; arHoliday: number; arWeekoff: number; essLeaveTotal: number; pmDaysPresant: number; pmDaysLeave: number }

function computePayDays(prorateCode: string | undefined, d: PayDaysInputs): number {
  if (prorateCode === '2') return d.pmDaysPresant + d.pmDaysLeave + d.essLeaveTotal; // Working Days
  if (!prorateCode || prorateCode === '1') return d.arPresent + d.arLeave + d.arHoliday + d.arWeekoff; // Calendar Days
  return 30; // Fixed Days
}

// Matches legacy's bank-details cleanup (comparison_report.ctp:488/493): collapse runs of repeated
// commas (e.g. from blank bank-detail segments) down to one, then trim a leading/trailing comma.
function cleanBankDetails(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/,(\s*,)+/g, ',').replace(/^,|,$/g, '');
}

export interface GrossPivotItem { label: string; amount: number }

// Mirrors legacy's $arr_keys (GenerateSalaryGrossNonExemted, SalaryReportsController.php:42071-42076)
// — the fixed, ordered set of every distinct salary-head-item that appears in ANY employee's
// emp_salary_slip for the selected month. Deliberately scoped to the month only, not the selected
// criteria, so every row in the report gets the same dynamic column set (zero-filled where an
// employee doesn't have a given head) rather than a column set that shifts per selection.
async function getSalaryHeadKeys(pool: Pool, monthYear: string): Promise<{ additionLabels: string[]; deductionLabels: string[] }> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT TRIM(ess.salary_head_item_desc) AS label, ess.head_operator
     FROM emp_salary_slip ess
     LEFT JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
     WHERE ess.item_part = 'Direct' AND ess.end_date_effective IS NULL AND ess.month_year = ?
     GROUP BY ess.salary_head_item_desc, ess.head_operator, shi.salary_head_item_order1
     ORDER BY shi.salary_head_item_order1`,
    [monthYear]
  );
  const additionLabels: string[] = [];
  const deductionLabels: string[] = [];
  for (const r of rows as RowDataPacket[]) {
    (r.head_operator === 'Addition' ? additionLabels : deductionLabels).push(String(r.label));
  }
  return { additionLabels, deductionLabels };
}

export interface PayrollCtcItem { label: string; amount: number; rate: number }
interface PayrollCtcKeyItem { fkey: number; label: string }
interface PayrollCtcKeys {
  standardAdditions: PayrollCtcKeyItem[];
  standardDeductions: PayrollCtcKeyItem[];
  variable: PayrollCtcKeyItem[];
  employer: PayrollCtcKeyItem[];
  actualAddition: PayrollCtcKeyItem[];
  actualDeduction: PayrollCtcKeyItem[];
}

// Mirrors PayrollCTC's 5 *_keys queries (SalaryReportsController.php:22611-22646) — each
// independently scoped to the month only (not the selected criteria), same discipline as
// getSalaryHeadKeys, so every row gets the same zero-filled column set. Standard/Variable/Employer
// keep whichever head_operator each item actually has (split client-side); Actual Addition/
// Deduction bake the operator into the query itself, matching legacy's two separate queries.
async function getPayrollCtcKeys(pool: Pool, monthYear: string): Promise<PayrollCtcKeys> {
  const [standardRows] = await pool.execute<RowDataPacket[]>(
    `SELECT TRIM(ectc.salary_head_item_desc) AS label, ectc.head_operator AS operator, ectc.salary_head_item_fkey AS fkey
     FROM emp_salary_slip ectc
     LEFT JOIN salary_head_items salhead ON salhead.salary_head_item_pkey = ectc.salary_head_item_fkey
     LEFT JOIN salary_heads ON salary_heads.head_pkey = salhead.head_fkey
     WHERE ectc.item_part = 'Direct' AND ectc.end_date_effective IS NULL AND ectc.month_year = ? AND salary_heads.head_pkey IN (1,5)
     GROUP BY ectc.salary_head_item_desc, ectc.head_operator, ectc.salary_head_item_fkey, salhead.salary_head_item_order1
     ORDER BY salhead.salary_head_item_order1 ASC`,
    [monthYear]
  );
  const [variableRows] = await pool.execute<RowDataPacket[]>(
    `SELECT TRIM(ectc.salary_head_item_desc) AS label, ectc.salary_head_item_fkey AS fkey
     FROM emp_salary_slip ectc
     LEFT JOIN salary_head_items salhead ON salhead.salary_head_item_pkey = ectc.salary_head_item_fkey
     LEFT JOIN salary_heads ON salary_heads.head_pkey = salhead.head_fkey
     WHERE ectc.item_part = 'Direct' AND ectc.end_date_effective IS NULL AND ectc.month_year = ? AND salary_heads.head_pkey IN (2,7,9)
     GROUP BY ectc.salary_head_item_desc, ectc.salary_head_item_fkey, salhead.salary_head_item_order1
     ORDER BY salhead.salary_head_item_order1 ASC`,
    [monthYear]
  );
  const [employerRows] = await pool.execute<RowDataPacket[]>(
    `SELECT TRIM(ectc.salary_head_item_desc) AS label, ectc.salary_head_item_fkey AS fkey
     FROM emp_salary_slip ectc
     LEFT JOIN salary_head_items salhead ON salhead.salary_head_item_pkey = ectc.salary_head_item_fkey
     LEFT JOIN salary_heads ON salary_heads.head_pkey = salhead.head_fkey
     WHERE ectc.item_part = 'Indirect' AND ectc.end_date_effective IS NULL AND ectc.month_year = ? AND salary_heads.head_pkey = 4
     GROUP BY ectc.salary_head_item_desc, ectc.salary_head_item_fkey, salhead.salary_head_item_order1
     ORDER BY salhead.salary_head_item_order1 ASC`,
    [monthYear]
  );
  const [actualAdditionRows] = await pool.execute<RowDataPacket[]>(
    `SELECT TRIM(ectc.salary_head_item_desc) AS label, ectc.salary_head_item_fkey AS fkey
     FROM emp_salary_slip ectc
     LEFT JOIN salary_head_items salhead ON salhead.salary_head_item_pkey = ectc.salary_head_item_fkey
     LEFT JOIN salary_heads ON salary_heads.head_pkey = salhead.head_fkey
     WHERE ectc.item_part = 'Direct' AND ectc.end_date_effective IS NULL AND ectc.month_year = ?
       AND (ectc.head_type = 'Manually' OR ectc.head_type = 'Fixed')
       AND (salary_heads.head_pkey NOT IN (1,5,2,7,9) OR salary_heads.head_pkey IS NULL)
       AND ectc.head_operator = 'Addition'
     GROUP BY ectc.salary_head_item_desc, ectc.salary_head_item_fkey, salhead.salary_head_item_order1
     ORDER BY salhead.salary_head_item_order1 ASC`,
    [monthYear]
  );
  const [actualDeductionRows] = await pool.execute<RowDataPacket[]>(
    `SELECT TRIM(ectc.salary_head_item_desc) AS label, ectc.salary_head_item_fkey AS fkey
     FROM emp_salary_slip ectc
     LEFT JOIN salary_head_items salhead ON salhead.salary_head_item_pkey = ectc.salary_head_item_fkey
     LEFT JOIN salary_heads ON salary_heads.head_pkey = salhead.head_fkey
     WHERE ectc.item_part = 'Direct' AND ectc.end_date_effective IS NULL AND ectc.month_year = ?
       AND (ectc.head_type = 'Manually' OR ectc.head_type = 'Fixed')
       AND (salary_heads.head_pkey NOT IN (1,5,2,7,9) OR salary_heads.head_pkey IS NULL)
       AND ectc.head_operator = 'Deduction'
     GROUP BY ectc.salary_head_item_desc, ectc.salary_head_item_fkey, salhead.salary_head_item_order1
     ORDER BY salhead.salary_head_item_order1 ASC`,
    [monthYear]
  );
  const toKey = (r: RowDataPacket): PayrollCtcKeyItem => ({ fkey: Number(r.fkey), label: String(r.label) });
  return {
    standardAdditions: (standardRows as RowDataPacket[]).filter((r) => r.operator === 'Addition').map(toKey),
    standardDeductions: (standardRows as RowDataPacket[]).filter((r) => r.operator === 'Deduction').map(toKey),
    variable: (variableRows as RowDataPacket[]).map(toKey),
    employer: (employerRows as RowDataPacket[]).map(toKey),
    actualAddition: (actualAdditionRows as RowDataPacket[]).map(toKey),
    actualDeduction: (actualDeductionRows as RowDataPacket[]).map(toKey),
  };
}

// Per-employee, per-head-item {amount, rate} lookup — mirrors legacy's per-employee $salary_lookup
// (SalaryReportsController.php:22793-22819), except batched across all matching employees in one
// query instead of one query per employee. Deliberately no item_part/head_operator filter here (the
// filtering already happened when building the key lists above); this is a raw fkey->value lookup.
async function getPayrollCtcValues(pool: Pool, empFkeys: number[], monthYear: string): Promise<Map<number, Map<number, { amount: number; rate: number }>>> {
  const map = new Map<number, Map<number, { amount: number; rate: number }>>();
  if (empFkeys.length === 0) return map;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ess.emp_fkey, ess.salary_head_item_fkey AS fkey, ess.salary_amount, ess.structure_det_value
     FROM emp_salary_slip ess
     WHERE ess.emp_fkey IN (?) AND ess.month_year = ? AND ess.end_date_effective IS NULL`,
    [empFkeys, monthYear]
  );
  for (const r of rows as RowDataPacket[]) {
    let m = map.get(r.emp_fkey);
    if (!m) { m = new Map(); map.set(r.emp_fkey, m); }
    m.set(Number(r.fkey), { amount: Number(r.salary_amount ?? 0), rate: Number(r.structure_det_value ?? 0) });
  }
  return map;
}

function buildPayrollCtcItems(keys: PayrollCtcKeyItem[], values: Map<number, { amount: number; rate: number }> | undefined): PayrollCtcItem[] {
  return keys.map((k) => {
    const v = values?.get(k.fkey);
    return { label: k.label, amount: v?.amount ?? 0, rate: v?.rate ?? 0 };
  });
}

interface GrossPivotAmounts { standard: number; actual: number }
interface GrossPivotEntry { addition: Map<string, GrossPivotAmounts>; deduction: Map<string, GrossPivotAmounts> }

// Per-employee, per-head-item sums of structure_det_value ("Standard Salary" in legacy's HTML —
// confusingly legacy's own PHP array key for this is named 'actual') and salary_amount ("Actual
// Salary" in legacy's HTML — legacy's PHP array key for this is named 'value'). A single GROUP BY
// here computes the same per-item sums legacy accumulates in a PHP loop
// (SalaryReportsController.php:42217-42229).
async function getGrossPivot(pool: Pool, payrollMasterPkeys: number[]): Promise<Map<number, GrossPivotEntry>> {
  const map = new Map<number, GrossPivotEntry>();
  if (payrollMasterPkeys.length === 0) return map;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ess.payroll_master_fkey, TRIM(ess.salary_head_item_desc) AS label, ess.head_operator,
            SUM(ess.structure_det_value) AS standard_amount, SUM(ess.salary_amount) AS actual_amount
     FROM emp_salary_slip ess
     WHERE ess.payroll_master_fkey IN (?) AND ess.item_part = 'Direct' AND ess.end_date_effective IS NULL
     GROUP BY ess.payroll_master_fkey, ess.salary_head_item_desc, ess.head_operator`,
    [payrollMasterPkeys]
  );
  for (const r of rows as RowDataPacket[]) {
    let entry = map.get(r.payroll_master_fkey);
    if (!entry) { entry = { addition: new Map(), deduction: new Map() }; map.set(r.payroll_master_fkey, entry); }
    const bucket = r.head_operator === 'Addition' ? entry.addition : entry.deduction;
    bucket.set(String(r.label), { standard: Number(r.standard_amount), actual: Number(r.actual_amount) });
  }
  return map;
}

// GrosssalarySummary's Present/Leave/LOP Days come from emp_salary_slip's own duplicated-per-row
// presant_total/leave_total/lop_total columns (SalaryReportsController.php:11576-11578), not
// payroll_master/attendance_register like the other reports on this screen — every Direct row for
// the same employee+month carries the same value, so MAX() picks it once per employee.
async function getSalarySlipTotals(pool: Pool, payrollMasterPkeys: number[]): Promise<Map<number, { presentDays: number; leaveDays: number; lopDays: number }>> {
  const map = new Map<number, { presentDays: number; leaveDays: number; lopDays: number }>();
  if (payrollMasterPkeys.length === 0) return map;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ess.payroll_master_fkey, MAX(ess.presant_total) AS present_days,
            MAX(ess.leave_total) AS leave_days, MAX(ess.lop_total) AS lop_days
     FROM emp_salary_slip ess
     WHERE ess.payroll_master_fkey IN (?) AND ess.item_part = 'Direct' AND ess.end_date_effective IS NULL
     GROUP BY ess.payroll_master_fkey`,
    [payrollMasterPkeys]
  );
  for (const r of rows as RowDataPacket[]) {
    map.set(r.payroll_master_fkey, {
      presentDays: Number(r.present_days ?? 0), leaveDays: Number(r.leave_days ?? 0), lopDays: Number(r.lop_days ?? 0),
    });
  }
  return map;
}

// Builds one employee's zero-filled Standard/Actual Addition/Deduction column set plus the
// Gross/Deduction/Net figures legacy derives from it (SalaryReportsController.php:43229-43323).
// Only the Actual (salary_amount) section feeds Gross/Deduction/Net — the Standard (structure_det_
// value) section is display-only, matching legacy exactly. The Actual Addition loop also replicates
// legacy's rounding-remainder trick (lines 43269-43279): summing each item pre-rounded-to-2dp vs
// rounded-to-integer, and folding the lost paise into the first item, so displayed items always sum
// exactly to the displayed Gross Salary instead of drifting by a rupee from independent rounding.
function buildGrossPivotRow(
  entry: GrossPivotEntry | undefined,
  additionLabels: string[],
  deductionLabels: string[],
  settlementAmount: number
) {
  const addition = entry?.addition ?? new Map<string, GrossPivotAmounts>();
  const deduction = entry?.deduction ?? new Map<string, GrossPivotAmounts>();

  const standardAddition: GrossPivotItem[] = additionLabels.map((label) => ({
    label, amount: Math.round(addition.get(label)?.standard ?? 0),
  }));
  const standardGross = standardAddition.reduce((s, i) => s + i.amount, 0);
  const standardDeduction: GrossPivotItem[] = deductionLabels.map((label) => ({
    label, amount: -Math.round(Math.abs(deduction.get(label)?.standard ?? 0)),
  }));

  const actualValues = additionLabels.map((label) => addition.get(label)?.actual ?? 0);
  const ogTotal = actualValues.reduce((s, v) => s + Math.round(v * 100) / 100, 0);
  const rndTotal = actualValues.reduce((s, v) => s + Math.round(v), 0);
  const diff = Math.round(ogTotal) - rndTotal;
  const actualAddition: GrossPivotItem[] = additionLabels.map((label, m) => ({
    label, amount: Math.round(actualValues[m]) + (m === 0 ? diff : 0),
  }));
  const actualGross = actualAddition.reduce((s, i) => s + i.amount, 0);
  const actualDeduction: GrossPivotItem[] = deductionLabels.map((label) => ({
    label, amount: -Math.round(Math.abs(deduction.get(label)?.actual ?? 0)),
  }));
  const totalDeduction = -actualDeduction.reduce((s, i) => s + Math.abs(i.amount), 0);
  const netSalary = Math.round(actualGross + totalDeduction + settlementAmount);

  return { standardAddition, standardGross, standardDeduction, actualAddition, actualGross, actualDeduction, totalDeduction, netSalary };
}

// Mirrors GenerateSalaryGrossNewNotExempted's three parallel key sets (SalaryReportsController.php:
// 43863-43874) — unlike Grosssalary's single Standard-vs-Actual pivot, this report adds a third
// "Other Salary" (Variable) column group: Standard = salary_heads.head_pkey IN (1,5), Variable =
// head_pkey IN (2,7,9) AND emp_salary_slip.head_type <> 'Manually' (Addition side only — legacy's
// "Other Salary" block has no matching Deduction columns), Actual = every Direct head (unfiltered),
// same as Grosssalary's $arr_keys. All three scoped to the month only, not the selected criteria,
// so every row gets the same zero-filled column set.
async function getGrossNewSalaryHeadKeys(pool: Pool, monthYear: string) {
  const [actualRows] = await pool.execute<RowDataPacket[]>(
    `SELECT TRIM(ess.salary_head_item_desc) AS label, ess.head_operator
     FROM emp_salary_slip ess
     LEFT JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
     WHERE ess.item_part = 'Direct' AND ess.end_date_effective IS NULL AND ess.month_year = ?
     GROUP BY ess.salary_head_item_desc, ess.head_operator, shi.salary_head_item_order1
     ORDER BY shi.salary_head_item_order1`,
    [monthYear]
  );
  const [standardRows] = await pool.execute<RowDataPacket[]>(
    `SELECT TRIM(ess.salary_head_item_desc) AS label, ess.head_operator
     FROM emp_salary_slip ess
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
     JOIN salary_heads sh ON sh.head_pkey = shi.head_fkey
     WHERE ess.item_part = 'Direct' AND ess.end_date_effective IS NULL AND ess.month_year = ? AND sh.head_pkey IN (1, 5)
     GROUP BY ess.salary_head_item_desc, ess.head_operator, shi.salary_head_item_order1
     ORDER BY shi.salary_head_item_order1`,
    [monthYear]
  );
  const [variableRows] = await pool.execute<RowDataPacket[]>(
    `SELECT TRIM(ess.salary_head_item_desc) AS label
     FROM emp_salary_slip ess
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
     JOIN salary_heads sh ON sh.head_pkey = shi.head_fkey
     WHERE ess.item_part = 'Direct' AND ess.end_date_effective IS NULL AND ess.month_year = ?
       AND sh.head_pkey IN (2, 7, 9) AND ess.head_operator = 'Addition' AND ess.head_type <> 'Manually'
     GROUP BY ess.salary_head_item_desc, shi.salary_head_item_order1
     ORDER BY shi.salary_head_item_order1`,
    [monthYear]
  );
  const splitByOperator = (rows: RowDataPacket[]) => {
    const addition: string[] = [];
    const deduction: string[] = [];
    for (const r of rows) (r.head_operator === 'Addition' ? addition : deduction).push(String(r.label));
    return { addition, deduction };
  };
  const actual = splitByOperator(actualRows as RowDataPacket[]);
  const standard = splitByOperator(standardRows as RowDataPacket[]);
  return {
    actualAdditionLabels: actual.addition, actualDeductionLabels: actual.deduction,
    standardAdditionLabels: standard.addition, standardDeductionLabels: standard.deduction,
    variableAdditionLabels: (variableRows as RowDataPacket[]).map((r) => String(r.label)),
  };
}

// Builds one employee's zero-filled Standard/Variable/Actual column set for GrosssalaryNew — same
// per-employee pivot map as Grosssalary (getGrossPivot), just sliced by three different label sets
// instead of one. No rounding-remainder reconciliation here — confirmed absent from
// grossreportnew_non_exempted.ctp (unlike Grosssalary's grossreport.ctp), so plain per-item rounding
// is legacy-accurate for this report, not a gap.
function buildGrossNewPivotRow(
  entry: GrossPivotEntry | undefined,
  keys: Awaited<ReturnType<typeof getGrossNewSalaryHeadKeys>>,
  settlementAmount: number
) {
  const addition = entry?.addition ?? new Map<string, GrossPivotAmounts>();
  const deduction = entry?.deduction ?? new Map<string, GrossPivotAmounts>();

  const standardAddition: GrossPivotItem[] = keys.standardAdditionLabels.map((label) => ({
    label, amount: Math.round(addition.get(label)?.standard ?? 0),
  }));
  const standardGross = standardAddition.reduce((s, i) => s + i.amount, 0);
  const standardDeduction: GrossPivotItem[] = keys.standardDeductionLabels.map((label) => ({
    label, amount: -Math.round(Math.abs(deduction.get(label)?.standard ?? 0)),
  }));

  const variableAddition: GrossPivotItem[] = keys.variableAdditionLabels.map((label) => ({
    label, amount: Math.round(addition.get(label)?.actual ?? 0),
  }));
  const variableTotal = variableAddition.reduce((s, i) => s + i.amount, 0);

  const actualAddition: GrossPivotItem[] = keys.actualAdditionLabels.map((label) => ({
    label, amount: Math.round(addition.get(label)?.actual ?? 0),
  }));
  const actualGross = actualAddition.reduce((s, i) => s + i.amount, 0);
  const actualDeduction: GrossPivotItem[] = keys.actualDeductionLabels.map((label) => ({
    label, amount: -Math.round(Math.abs(deduction.get(label)?.actual ?? 0)),
  }));
  const totalDeduction = -actualDeduction.reduce((s, i) => s + Math.abs(i.amount), 0);
  const netSalary = Math.round(actualGross + totalDeduction + settlementAmount);

  return {
    standardAddition, standardGross, standardDeduction,
    variableAddition, variableTotal,
    actualAddition, actualGross, actualDeduction, totalDeduction, netSalary,
  };
}

// Gross Salary Period Wise's column list (SalaryReportsController.php:7577-7581) has NO date filter
// at all in legacy — it scans every emp_salary_slip row ever recorded for distinct head items.
// Scoped here to the requested date range instead: a disclosed, more useful/performant deviation
// (avoids permanently-zero columns for heads that predate or postdate the selected range), not a
// literal replication.
async function getSalaryHeadKeysRange(pool: Pool, fromMonth: string, toMonth: string): Promise<{ additionLabels: string[]; deductionLabels: string[] }> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT TRIM(ess.salary_head_item_desc) AS label, ess.head_operator
     FROM emp_salary_slip ess
     LEFT JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
     WHERE ess.item_part = 'Direct' AND ess.end_date_effective IS NULL AND ess.month_year BETWEEN ? AND ?
     GROUP BY ess.salary_head_item_desc, ess.head_operator, shi.salary_head_item_order1
     ORDER BY shi.salary_head_item_order1`,
    [fromMonth, toMonth]
  );
  const additionLabels: string[] = [];
  const deductionLabels: string[] = [];
  for (const r of rows as RowDataPacket[]) {
    (r.head_operator === 'Addition' ? additionLabels : deductionLabels).push(String(r.label));
  }
  return { additionLabels, deductionLabels };
}

interface GrossPeriodPivotEntry { addition: Map<string, number>; deduction: Map<string, number> }

// Per-employee sums of salary_amount across every Direct emp_salary_slip row in the selected date
// range (SalaryReportsController.php:7753-7853/8175-8196 accumulate the same sums in a PHP loop
// keyed by employee, `+=` per matching month) — one SQL GROUP BY replaces that loop. Legacy's
// per-row negative-salary filter (`$conditions1`, applied to which emp_salary_slip rows even
// qualify, not to the employee's total) is replicated via the same payroll_master_fkey subquery.
async function getGrossPeriodPivot(
  pool: Pool, empFkeys: number[], fromMonth: string, toMonth: string, includeNegative: boolean | undefined
): Promise<Map<number, GrossPeriodPivotEntry>> {
  const map = new Map<number, GrossPeriodPivotEntry>();
  if (empFkeys.length === 0) return map;
  const negativeSubquery = includeNegative
    ? 'SELECT payroll_master_pkey FROM payroll_master WHERE net_salary IS NOT NULL'
    : 'SELECT payroll_master_pkey FROM payroll_master WHERE net_salary >= 0';
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ess.emp_fkey, TRIM(ess.salary_head_item_desc) AS label, ess.head_operator, SUM(ess.salary_amount) AS amount
     FROM emp_salary_slip ess
     WHERE ess.emp_fkey IN (?) AND ess.month_year BETWEEN ? AND ? AND ess.item_part = 'Direct'
       AND ess.salary_amount <> 0 AND ess.end_date_effective IS NULL
       AND ess.payroll_master_fkey IN (${negativeSubquery})
     GROUP BY ess.emp_fkey, ess.salary_head_item_desc, ess.head_operator`,
    [empFkeys, fromMonth, toMonth]
  );
  for (const r of rows as RowDataPacket[]) {
    let entry = map.get(r.emp_fkey);
    if (!entry) { entry = { addition: new Map(), deduction: new Map() }; map.set(r.emp_fkey, entry); }
    const bucket = r.head_operator === 'Addition' ? entry.addition : entry.deduction;
    bucket.set(String(r.label), Number(r.amount));
  }
  return map;
}

// Builds one employee's zero-filled Addition/Deduction column set plus Gross/Deduction/Net
// (SalaryReportsController.php:8175-8203) — a single pivot, unlike Grosssalary's Standard-vs-Actual
// split (this report's own 'actual'/structure_det_value accumulator is set but never read by either
// the view or the Excel export — confirmed dead by its absence from report_period.ctp/the Excel
// branch, so it's not ported). Addition items round to the nearest rupee per item (no
// rounding-remainder reconciliation — absent from this report's legacy code, unlike Grosssalary's
// detailed report); Deduction items round to 2 decimal places per item — both exactly as legacy
// displays them.
function buildGrossPeriodPivotRow(
  entry: GrossPeriodPivotEntry | undefined,
  additionLabels: string[],
  deductionLabels: string[],
  settlementAmount: number
) {
  const addition = entry?.addition ?? new Map<string, number>();
  const deduction = entry?.deduction ?? new Map<string, number>();

  const additionItems: GrossPivotItem[] = additionLabels.map((label) => ({
    label, amount: Math.round(addition.get(label) ?? 0),
  }));
  const grossSalary = additionItems.reduce((s, i) => s + i.amount, 0);
  const deductionItems: GrossPivotItem[] = deductionLabels.map((label) => ({
    label, amount: -Math.round(Math.abs(deduction.get(label) ?? 0) * 100) / 100,
  }));
  const totalDeduction = -deductionItems.reduce((s, i) => s + Math.abs(i.amount), 0);
  const netSalary = Math.round(grossSalary + totalDeduction + settlementAmount);

  return { additionItems, grossSalary, deductionItems, totalDeduction, netSalary };
}

// Mirrors SalaryReportsController::GenerateSummaryPayrolreport and sibling generate<X>report
// methods for the other report-type variants on the same "Salary" screen.
export async function generatePayrollReport(pool: Pool, params: PayrollReportParams) {
  requireCriteria(params.criteria);

  if (params.subtype === 'salary') {
    // CTC Summary — mirrors SalaryReportsController::generatesalaryreport() (the generic path used
    // by every real tenant; a separate PSQUARE variant exists only for demo companies DEMO/SRTS and
    // sources emp_ctc_transaction instead — an earlier port of this report was built against that
    // demo-only variant, which returns structurally wrong numbers for every other company). The real
    // source is emp_salary_structure: CTC = SUM(ABS(structure_det_value)) over the Addition-side
    // rows in salary_heads 1 (Monthly Salary Components), 4 (Employer Contributions), 10 (Variable
    // Deductions — despite the name, filtered here to its Addition-flagged rows only), replicated
    // verbatim rather than re-derived from business meaning.
    const statusCondition = params.includeResigned ? 'ed.status IN (1,2)' : 'ed.status = 1';
    // Legacy filters branch selection on emp_details.branch_code even though the branch *name* is
    // joined via emp_proff.emp_branch — kept as-is rather than "fixed", to match real behavior.
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'ed.branch_code', EmployeeDetails: 'ed.emp_pkey',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT ep.emp_company_id AS employee_id, uc.user_id AS login_user_id,
              CASE WHEN ed.status = 2 THEN CONCAT(ed.first_name, ' ', ed.last_name, ' (Resigned)')
                   ELSE CONCAT(ed.first_name, ' ', ed.last_name) END AS emp_name,
              DATE_FORMAT(ep.joining_date, '%Y-%m-%d') AS joining_date,
              br.branch_name, dep.dept_name AS department, desig.desig_name AS designation,
              DATE_FORMAT(tm.last_approved_working_date, '%Y-%m-%d') AS termination_date,
              ROUND(SUM(ABS(ess.structure_det_value))) AS monthly_ctc,
              ROUND(SUM(ABS(ess.structure_det_value)) * 12) AS annual_ctc
       FROM emp_details ed
       LEFT JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
       LEFT JOIN emp_salary_structure ess ON ess.emp_fkey = ed.emp_pkey
         AND (ess.end_date_effective IS NULL OR ess.end_date_effective = '0000-00-00')
         AND ess.head_operator = 'Addition'
       LEFT JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
       LEFT JOIN user_credentials uc ON uc.emp_fkey = ed.emp_pkey
       LEFT JOIN termination tm ON tm.emp_fkey = ep.emp_fkey AND tm.status = 1
       LEFT JOIN designation desig ON desig.desig_code = ep.designation AND desig.status = 1
       LEFT JOIN department dep ON dep.dept_code = ep.emp_dept
       LEFT JOIN branches br ON br.branch_code = ep.emp_branch
       WHERE ${statusCondition} AND shi.head_fkey IN (1,4,10) AND ${conditions.join(' AND ')}
       GROUP BY ed.emp_pkey
       ORDER BY ed.first_name`,
      args
    );
    return rows;
  }

  if (params.subtype === 'Grosssalary') {
    // Gross Salary Detailed — mirrors GenerateSalaryGrossNonExemted() (SalaryReportsController.php:
    // 42057-43849), the real path for any tenant not on the DEMO/SRTS/KWMT/GTRA/18-company-allowlist
    // special cases. Unlike the fixed-aggregate reports elsewhere in this file, legacy never trusts
    // payroll_master's stored gross_salary/total_deduction/net_salary here — it re-derives them from
    // emp_salary_slip via getSalaryHeadKeys/getGrossPivot/buildGrossPivotRow below. Only employees
    // with a user_credentials row appear (legacy: `inner join user_credentials`), and only those with
    // at least one Direct emp_salary_slip row for the month (legacy's real base table is
    // emp_salary_slip, not payroll_master).
    const statusCondition = params.includeResigned ? 'ed.status IN (1,2)' : 'ed.status = 1';
    const negativeCondition = params.includeNegative ? '' : ' AND pm.net_salary >= 0';
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey', Departments: 'ep.emp_dept',
      Designation: 'ep.designation', Gender: 'ed.classification',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.payroll_master_pkey, pm.emp_fkey,
              CASE WHEN ed.status = 2 THEN CONCAT(pm.emp_name, ' (Resigned)') ELSE pm.emp_name END AS emp_name,
              ep.emp_company_id AS employee_id, uc.user_id AS login_user_id, pm.branch_name,
              pm.departments, pm.desig, pm.month_year, ed.classification AS gender,
              DATE_FORMAT(i.joining_date, '%Y-%m-%d') AS joining_date,
              DATE_FORMAT(tm.last_approved_working_date, '%Y-%m-%d') AS termination_date,
              pm.days_presant, ar.lop_total AS non_paying_days, ar.lop_only AS lop_days,
              pm.days_leave, ar.weekoff_total, ar.holiday_total,
              COALESCE(ot.set_duration, 0) AS overtime_hours,
              COALESCE((SELECT SUM(ess.salary_amount) FROM emp_settle_slip ess
                        WHERE ess.emp_fkey = pm.emp_fkey AND ess.status = 'Y' AND ess.approved = 'Y' AND ess.type <> 'SALARY'
                          AND DATE_FORMAT(tm.last_approved_working_date, '%Y-%m') = pm.month_year), 0) AS settlement_amount
       FROM payroll_master pm
       JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
       JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
       INNER JOIN user_credentials uc ON uc.emp_fkey = pm.emp_fkey
       LEFT JOIN employee_info i ON i.emp_pkey = pm.emp_fkey
       LEFT JOIN termination tm ON tm.emp_fkey = pm.emp_fkey AND tm.status = 1
       LEFT JOIN attendance_register ar ON ar.emp_fkey = pm.emp_fkey AND ar.month_year = pm.month_year
       LEFT JOIN emp_ot_master ot ON ot.emp_fkey = pm.emp_fkey AND DATE_FORMAT(ot.month, '%Y-%m') = pm.month_year AND ot.is_verified = 'Y'
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${statusCondition}${negativeCondition}
         AND EXISTS (SELECT 1 FROM emp_salary_slip ess WHERE ess.payroll_master_fkey = pm.payroll_master_pkey
                       AND ess.item_part = 'Direct' AND ess.end_date_effective IS NULL)
         AND ${conditions.join(' AND ')}
       ORDER BY pm.emp_name`,
      [params.monthYear, ...args]
    );
    const pkeys = rows.map((r) => r.payroll_master_pkey);
    const [{ additionLabels, deductionLabels }, pivotMap] = await Promise.all([
      getSalaryHeadKeys(pool, params.monthYear),
      getGrossPivot(pool, pkeys),
    ]);
    return rows.map((row) => {
      const pivot = buildGrossPivotRow(pivotMap.get(row.payroll_master_pkey), additionLabels, deductionLabels, Number(row.settlement_amount));
      return { ...row, ...pivot };
    });
  }

  if (params.subtype === 'BankTranfer') {
    // Mirrors generateBanktransferreport() (SalaryReportsController.php:3996-4193), the generic
    // variant used by real tenants (DEMO/GLET/SRTS route to a separate PSQUARE-only variant, not
    // ported). LeavePolicyGroup and Banks are both legacy's mislabeled "belonging to a Bank"
    // criteria — both filter on the same resolved bank-name expression and share the same query
    // here; only the on-screen/Excel column set differs (Banks switches to the "Bank Statement"
    // shape — see SUBTYPE_META.BankTranfer in page.tsx). Not ported: legacy's extra "unbanked
    // employees" appended group for these two criteria (SalaryReportsController.php:4174-4193) — a
    // small, disclosed simplification, not silently dropped.
    const statusCondition = params.includeResigned ? 'ed.status IN (1,2)' : 'ed.status = 1';
    const negativeCondition = params.includeNegative ? '' : ' AND pm.net_salary >= 0';
    const bankNameExpr = "IFNULL(SUBSTRING_INDEX(pm.bank_details, ',', 1), ed.bank_name)";
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
      LeavePolicyGroup: bankNameExpr, Banks: bankNameExpr,
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.emp_fkey,
              CASE WHEN ed.status = 2 THEN CONCAT(pm.emp_name, ' (Resigned)') ELSE pm.emp_name END AS emp_name,
              ep.emp_company_id AS employee_id, uc.user_id AS login_user_id, pm.branch_name,
              pm.departments, pm.desig, pm.month_year,
              DATE_FORMAT(i.joining_date, '%Y-%m-%d') AS joining_date,
              DATE_FORMAT(tm.last_approved_working_date, '%Y-%m-%d') AS termination_date,
              pm.bank_details, ed.bank_name AS ed_bank_name, ed.branch_name AS ed_bank_branch,
              ed.ifsc_code AS ed_ifsc_code, ed.account_no AS ed_account_no,
              (pm.net_salary + COALESCE((SELECT SUM(ess.salary_amount) FROM emp_settle_slip ess
                        WHERE ess.emp_fkey = pm.emp_fkey AND ess.status = 'Y' AND ess.approved = 'Y' AND ess.type <> 'SALARY'
                          AND DATE_FORMAT(tm.last_approved_working_date, '%Y-%m') = pm.month_year), 0)) AS net_salary
       FROM payroll_master pm
       JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
       LEFT JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
       LEFT JOIN user_credentials uc ON uc.emp_fkey = pm.emp_fkey
       LEFT JOIN employee_info i ON i.emp_pkey = pm.emp_fkey
       LEFT JOIN termination tm ON tm.emp_fkey = pm.emp_fkey AND tm.status = 1
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${statusCondition}${negativeCondition}
         AND ${conditions.join(' AND ')}
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
    // Mirrors GenerateSalaryGrossNewNotExempted() (SalaryReportsController.php:43850-44302) — the
    // generic path for a real tenant. Built on emp_salary_slip like Grosssalary (never trusts
    // payroll_master's stored gross_salary/total_deduction/net_salary), but adds a third "Other
    // Salary" (Variable) pivot on top of Grosssalary's Standard/Actual split — see
    // getGrossNewSalaryHeadKeys/buildGrossNewPivotRow. Confirmed via live trace: this report does
    // NOT use Grosssalary's rounding-remainder reconciliation trick (absent from
    // grossreportnew_non_exempted.ctp), so plain per-item rounding here is legacy-accurate, not a
    // gap. Only Units/EmployeeDetails criteria are seeded for this report type (no Departments/
    // Designation/Gender, unlike what an earlier port assumed).
    const statusCondition = params.includeResigned ? 'ed.status IN (1,2)' : 'ed.status = 1';
    const negativeCondition = params.includeNegative ? '' : ' AND pm.net_salary >= 0';
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.payroll_master_pkey, pm.emp_fkey,
              CASE WHEN ed.status = 2 THEN CONCAT(pm.emp_name, ' (Resigned)') ELSE pm.emp_name END AS emp_name,
              ep.emp_company_id AS employee_id, uc.user_id AS login_user_id, pm.branch_name,
              pm.departments, pm.desig, pm.month_year,
              DATE_FORMAT(i.joining_date, '%Y-%m-%d') AS joining_date,
              DATE_FORMAT(tm.last_approved_working_date, '%Y-%m-%d') AS termination_date,
              pm.days_presant, pm.loss_of_pay AS non_paying_days, ar.lop_only AS lop_days,
              pm.days_leave, ar.weekoff_total, ar.holiday_total,
              COALESCE(ot.set_duration, 0) AS overtime_hours,
              COALESCE((SELECT SUM(ess.salary_amount) FROM emp_settle_slip ess
                        WHERE ess.emp_fkey = pm.emp_fkey AND ess.status = 'Y' AND ess.approved = 'Y' AND ess.type <> 'SALARY'
                          AND DATE_FORMAT(tm.last_approved_working_date, '%Y-%m') = pm.month_year), 0) AS settlement_amount
       FROM payroll_master pm
       JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
       JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
       INNER JOIN user_credentials uc ON uc.emp_fkey = pm.emp_fkey
       LEFT JOIN employee_info i ON i.emp_pkey = pm.emp_fkey
       LEFT JOIN termination tm ON tm.emp_fkey = pm.emp_fkey AND tm.status = 1
       LEFT JOIN attendance_register ar ON ar.emp_fkey = pm.emp_fkey AND ar.month_year = pm.month_year
       LEFT JOIN emp_ot_master ot ON ot.emp_fkey = pm.emp_fkey AND DATE_FORMAT(ot.month, '%Y-%m') = pm.month_year AND ot.is_verified = 'Y'
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${statusCondition}${negativeCondition}
         AND EXISTS (SELECT 1 FROM emp_salary_slip ess WHERE ess.payroll_master_fkey = pm.payroll_master_pkey
                       AND ess.item_part = 'Direct' AND ess.end_date_effective IS NULL)
         AND ${conditions.join(' AND ')}
       ORDER BY pm.emp_name`,
      [params.monthYear, ...args]
    );
    const pkeys = rows.map((r) => r.payroll_master_pkey);
    const [keys, pivotMap] = await Promise.all([
      getGrossNewSalaryHeadKeys(pool, params.monthYear),
      getGrossPivot(pool, pkeys),
    ]);
    return rows.map((row) => {
      const pivot = buildGrossNewPivotRow(pivotMap.get(row.payroll_master_pkey), keys, Number(row.settlement_amount));
      return { ...row, ...pivot };
    });
  }

  if (params.subtype === 'GrosssalarySummary') {
    // Mirrors GenerateSalaryGrossSummary() (SalaryReportsController.php:11153-11460). Despite the
    // name, it's an employee-level detail list grouped by branch (same row granularity as
    // Grosssalary), not a branch-totals aggregate — confirmed via the real view (grosssummaryreport.
    // ctp) and fixed once already. A second full trace against that same controller function turned
    // up further gaps beyond the row-granularity fix: Gross Salary/Total Deduction/Net Salary are
    // re-derived from emp_salary_slip (not trusted from payroll_master, same as Grosssalary — and
    // reusing the exact same getSalaryHeadKeys/getGrossPivot/buildGrossPivotRow helpers, since it's
    // literally the same underlying per-employee salary data just summarized instead of itemized);
    // Settlement Amount is folded in and shown as its own column; Present/Leave/LOP Days come from
    // emp_salary_slip's own duplicated columns, not payroll_master/attendance_register (see
    // getSalarySlipTotals); an employee needs at least one Direct emp_salary_slip row for the month
    // to appear at all (legacy's real base table); and Include Resigned/Include Negative Salary are
    // now wired (legacy only filters status on its Units-branch-wise path and has no negative filter
    // at all — both were applied here uniformly across criteria for consistency with how this screen
    // treats these two checkboxes everywhere else, not a literal-line-for-line replication).
    const statusCondition = params.includeResigned ? 'ed.status IN (1,2)' : 'ed.status = 1';
    const negativeCondition = params.includeNegative ? '' : ' AND pm.net_salary >= 0';
    const { conditions, args } = buildCriteriaConditions(params.criteria, { Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey' });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.payroll_master_pkey, pm.emp_fkey,
              CASE WHEN ed.status = 2 THEN CONCAT(pm.emp_name, ' (Resigned)') ELSE pm.emp_name END AS emp_name,
              ep.emp_company_id AS employee_id, uc.user_id AS login_user_id, pm.branch_name,
              pm.departments, pm.desig, pm.month_year,
              DATE_FORMAT(i.joining_date, '%Y-%m-%d') AS joining_date,
              DATE_FORMAT(tm.last_approved_working_date, '%Y-%m-%d') AS termination_date,
              ar.weekoff_total, ar.holiday_total,
              COALESCE((SELECT SUM(ess.salary_amount) FROM emp_settle_slip ess
                        WHERE ess.emp_fkey = pm.emp_fkey AND ess.status = 'Y' AND ess.approved = 'Y' AND ess.type <> 'SALARY'
                          AND DATE_FORMAT(tm.last_approved_working_date, '%Y-%m') = pm.month_year), 0) AS settlement_amount
       FROM payroll_master pm
       JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
       JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
       LEFT JOIN user_credentials uc ON uc.emp_fkey = pm.emp_fkey
       LEFT JOIN employee_info i ON i.emp_pkey = pm.emp_fkey
       LEFT JOIN termination tm ON tm.emp_fkey = pm.emp_fkey AND tm.status = 1
       LEFT JOIN attendance_register ar ON ar.emp_fkey = pm.emp_fkey AND ar.month_year = pm.month_year
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${statusCondition}${negativeCondition}
         AND EXISTS (SELECT 1 FROM emp_salary_slip ess WHERE ess.payroll_master_fkey = pm.payroll_master_pkey
                       AND ess.item_part = 'Direct' AND ess.end_date_effective IS NULL)
         AND ${conditions.join(' AND ')}
       ORDER BY pm.branch_name, pm.emp_name`,
      [params.monthYear, ...args]
    );
    const pkeys = rows.map((r) => r.payroll_master_pkey);
    const [{ additionLabels, deductionLabels }, pivotMap, totalsMap] = await Promise.all([
      getSalaryHeadKeys(pool, params.monthYear),
      getGrossPivot(pool, pkeys),
      getSalarySlipTotals(pool, pkeys),
    ]);
    return rows.map((row) => {
      const pivot = buildGrossPivotRow(pivotMap.get(row.payroll_master_pkey), additionLabels, deductionLabels, Number(row.settlement_amount));
      const totals = totalsMap.get(row.payroll_master_pkey);
      return {
        ...row,
        days_presant: totals?.presentDays ?? 0,
        days_leave: totals?.leaveDays ?? 0,
        lop_days: totals?.lopDays ?? 0,
        gross_salary: pivot.actualGross,
        total_deduction: pivot.totalDeduction,
        net_salary: pivot.netSalary,
      };
    });
  }

  if (params.subtype === 'GrossPeriod') {
    // Mirrors GenerateSalaryGrossPeriod() (SalaryReportsController.php:7568-7935) — a genuinely
    // different shape from every other report on this screen: not a per-month listing, but ONE row
    // per employee summing every Direct emp_salary_slip item across the WHOLE selected date range
    // (Present Days, Settlement, and the per-salary-head Addition/Deduction pivot are all summed
    // across months — see getSalaryHeadKeysRange/getGrossPeriodPivot/buildGrossPeriodPivotRow — not
    // shown month-by-month). Gross/Total Deduction/Net Salary are re-derived from that summed pivot
    // (same family as Grosssalary/GrosssalarySummary), never trusted from payroll_master. Legacy's
    // "Employee ID" column here is actually employee_info.emp_id (not emp_proff.emp_company_id, the
    // usual source elsewhere on this screen) and its "Company ID" column is employee_info.
    // employee_id — replicated as-is even though the two names read swapped.
    const toMonth = params.toMonthYear ?? params.monthYear;
    const statusCondition = params.includeResigned ? 'ed.status IN (1,2)' : 'ed.status = 1';
    const negativeSubquery = params.includeNegative
      ? 'SELECT payroll_master_pkey FROM payroll_master WHERE net_salary IS NOT NULL'
      : 'SELECT payroll_master_pkey FROM payroll_master WHERE net_salary >= 0';
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'ed.branch_code', EmployeeDetails: 'ess.emp_fkey',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT ess.emp_fkey,
              CASE WHEN ed.status = 2 THEN CONCAT(i.EmpName, ' (Resigned)') ELSE i.EmpName END AS emp_name,
              i.emp_id AS employee_id, i.employee_id AS company_id, uc.user_id AS login_user_id,
              i.branch AS branch_name, i.department AS departments, i.designation AS desig,
              ed.classification AS gender,
              DATE_FORMAT(i.joining_date, '%Y-%m-%d') AS joining_date,
              DATE_FORMAT(tm.last_approved_working_date, '%Y-%m-%d') AS termination_date,
              COALESCE((SELECT SUM(pm.days_presant) FROM payroll_master pm
                        WHERE pm.emp_fkey = ess.emp_fkey AND pm.month_year BETWEEN ? AND ?
                          AND pm.action IN ('Approved','Processed')), 0) AS days_presant,
              COALESCE((SELECT SUM(es2.salary_amount) FROM emp_settle_slip es2
                        WHERE es2.emp_fkey = ess.emp_fkey AND es2.status = 'Y' AND es2.approved = 'Y' AND es2.type <> 'SALARY'
                          AND DATE_FORMAT(tm.last_approved_working_date, '%Y-%m') BETWEEN ? AND ?), 0) AS settlement_amount
       FROM emp_salary_slip ess
       JOIN employee_info i ON i.emp_pkey = ess.emp_fkey
       JOIN emp_details ed ON ed.emp_pkey = ess.emp_fkey
       LEFT JOIN user_credentials uc ON uc.emp_fkey = ess.emp_fkey
       LEFT JOIN termination tm ON tm.emp_fkey = ess.emp_fkey AND tm.status = 1
       WHERE ess.month_year BETWEEN ? AND ? AND ess.item_part = 'Direct' AND ess.salary_amount <> 0
         AND ess.end_date_effective IS NULL AND ${statusCondition}
         AND ess.payroll_master_fkey IN (${negativeSubquery})
         AND ${conditions.join(' AND ')}
       GROUP BY ess.emp_fkey
       ORDER BY i.EmpName`,
      [params.monthYear, toMonth, params.monthYear, toMonth, params.monthYear, toMonth, ...args]
    );
    const empFkeys = rows.map((r) => r.emp_fkey);
    const [{ additionLabels, deductionLabels }, pivotMap] = await Promise.all([
      getSalaryHeadKeysRange(pool, params.monthYear, toMonth),
      getGrossPeriodPivot(pool, empFkeys, params.monthYear, toMonth, params.includeNegative),
    ]);
    return rows.map((row) => {
      const pivot = buildGrossPeriodPivotRow(pivotMap.get(row.emp_fkey), additionLabels, deductionLabels, Number(row.settlement_amount));
      return {
        ...row,
        additionItems: pivot.additionItems,
        deductionItems: pivot.deductionItems,
        gross_salary: pivot.grossSalary,
        total_deduction: pivot.totalDeduction,
        net_salary: pivot.netSalary,
      };
    });
  }

  if (params.subtype === 'Comparison') {
    // Mirrors GenerateSalaryComparison() (SalaryReportsController.php:18068-19008) — compares the
    // selected month against the prior calendar month, computed server-side (legacy: DateTime::
    // modify('-1 month')), not a user-picked second date. Legacy's comparison_report.ctp shows FIVE
    // separate metric groups, not one undifferentiated CTC/Gross/Net triplet — Phase 1 of a
    // multi-phase rebuild (see conversation) fixes these at the source:
    //   - CTC (Standard) = SUM(ABS(structure_det_value)), Addition-only, NOT filtered by item_part.
    //   - CTC (Actual) = same but salary_amount, also not filtered by item_part.
    //   - Gross Salary (Standard) = SUM(ROUND(structure_det_value)) where head_fkey=1, item_part='Direct'.
    //   - Gross Salary (Actual) = same but salary_amount.
    //   - Net Salary (Actual) = total_salary − total_deduction (both re-summed from emp_salary_slip,
    //     item_part='Direct') — NEVER payroll_master.net_salary, which legacy doesn't even read here.
    // Total Deduction/Total Salary are computed but not shown as their own columns in legacy (only
    // used internally for Net Salary), so they aren't exposed here either.
    // Phase 2 fixed the per-item pivot: getComparisonItemLabels/getComparisonItemValues below source
    // structure_det_value restricted to head_fkey IN (1,4,5), one value per employee per label per
    // month (not the old, wrong salary_amount/no-head-filter source this report used to share with
    // GrosssalaryNew — that source is a genuinely different, and correct, pivot for that report;
    // Comparison just needed its own).
    // Phase 3 fixed Pay Days: see getProrateCodes/computePayDays below for the Calendar/Working/
    // Fixed Days policy formula (was a flat payroll_master.days_presant).
    // Phase 4 added the three change-detection flag columns (Variable Additions/Deductions Count,
    // Bank Account — each a count/string pair plus its own "No change"/"Change identified" flag).
    // Phase 5 (final) added the row-level `status` field aggregating every metric above
    // (comparison_report.ctp:334) and fixes View/Excel grouping to match legacy exactly: branch-
    // grouped only for the Units criteria (`needBranchWiseReport`, confirmed identical between the
    // View at comparison_report.ctp:79 and the Excel branch at SalaryReportsController.php:19078),
    // flat for EmployeeDetails — see comparisonGroupBy in page.tsx (this rebuild is now complete).
    const prior = prevMonth(params.monthYear);
    const statusCondition = params.includeResigned ? 'ed.status IN (1,2)' : 'ed.status = 1';
    const negativeCondition = params.includeNegative ? '' : ' AND pm.net_salary >= 0';
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
    });
    // Each metric group needs the same shape of correlated subquery run once per month — built as
    // parameterized SQL fragments (never string-interpolating the month) so the two invocations of
    // each expr just contribute their own '?' placeholders, bound in the same order via monthArgs.
    const monthArgs: string[] = [];
    const bind = (month: string) => { monthArgs.push(month); return '?'; };
    const ctcStandardExpr = (month: string) =>
      `(SELECT SUM(ROUND(ABS(ess.structure_det_value))) FROM emp_salary_slip ess
          WHERE ess.emp_fkey = pm.emp_fkey AND ess.month_year = ${bind(month)} AND ess.end_date_effective IS NULL
            AND ess.head_operator = 'Addition')`;
    const ctcActualExpr = (month: string) =>
      `(SELECT SUM(ROUND(ABS(ess.salary_amount))) FROM emp_salary_slip ess
          WHERE ess.emp_fkey = pm.emp_fkey AND ess.month_year = ${bind(month)} AND ess.end_date_effective IS NULL
            AND ess.head_operator = 'Addition')`;
    const grossStandardExpr = (month: string) =>
      `(SELECT SUM(ROUND(ess.structure_det_value)) FROM emp_salary_slip ess
          WHERE ess.emp_fkey = pm.emp_fkey AND ess.month_year = ${bind(month)} AND ess.end_date_effective IS NULL
            AND ess.item_part = 'Direct'
            AND ess.salary_head_item_fkey IN (SELECT salary_head_item_pkey FROM salary_head_items WHERE head_fkey = 1))`;
    const grossActualExpr = (month: string) =>
      `(SELECT SUM(ROUND(ess.salary_amount)) FROM emp_salary_slip ess
          WHERE ess.emp_fkey = pm.emp_fkey AND ess.month_year = ${bind(month)} AND ess.end_date_effective IS NULL
            AND ess.item_part = 'Direct'
            AND ess.salary_head_item_fkey IN (SELECT salary_head_item_pkey FROM salary_head_items WHERE head_fkey = 1))`;
    const totalAdditionExpr = (month: string) =>
      `(SELECT SUM(ROUND(ABS(ess.salary_amount))) FROM emp_salary_slip ess
          WHERE ess.emp_fkey = pm.emp_fkey AND ess.month_year = ${bind(month)} AND ess.end_date_effective IS NULL
            AND ess.item_part = 'Direct' AND ess.head_operator = 'Addition')`;
    const totalDeductionExpr = (month: string) =>
      `(SELECT SUM(ROUND(ABS(ess.salary_amount))) FROM emp_salary_slip ess
          WHERE ess.emp_fkey = pm.emp_fkey AND ess.month_year = ${bind(month)} AND ess.end_date_effective IS NULL
            AND ess.item_part = 'Direct' AND ess.head_operator = 'Deduction')`;
    const arExpr = (field: string, month: string) =>
      `(SELECT ar.${field} FROM attendance_register ar WHERE ar.emp_fkey = pm.emp_fkey AND ar.month_year = ${bind(month)} LIMIT 1)`;
    const essLeaveExpr = (month: string) =>
      `(SELECT ess.leave_total FROM emp_salary_slip ess WHERE ess.emp_fkey = pm.emp_fkey AND ess.month_year = ${bind(month)}
          AND ess.item_part = 'Direct' AND ess.end_date_effective IS NULL LIMIT 1)`;
    // operator is always one of the two literal strings below (never user input) — safe to
    // interpolate directly.
    const variableCountExpr = (operator: 'Addition' | 'Deduction', month: string) =>
      `(SELECT COUNT(*) FROM emp_salary_slip ess
          LEFT JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
          WHERE ess.emp_fkey = pm.emp_fkey AND ess.month_year = ${bind(month)} AND ess.end_date_effective IS NULL
            AND ess.item_part = 'Direct' AND ess.salary_amount <> 0 AND ess.head_operator = '${operator}'
            AND shi.head_fkey IN (SELECT head_pkey FROM salary_heads WHERE head_occurance = 'VARIABLE' AND status = 1))`;
    const selectExtra = `
              ${ctcStandardExpr(prior)} AS previous_ctc_standard, ${ctcStandardExpr(params.monthYear)} AS current_ctc_standard,
              ${ctcActualExpr(prior)} AS previous_ctc_actual, ${ctcActualExpr(params.monthYear)} AS current_ctc_actual,
              ${grossStandardExpr(prior)} AS previous_gross_standard, ${grossStandardExpr(params.monthYear)} AS current_gross_standard,
              ${grossActualExpr(prior)} AS previous_gross_actual, ${grossActualExpr(params.monthYear)} AS current_gross_actual,
              ${totalAdditionExpr(prior)} AS previous_total_addition, ${totalAdditionExpr(params.monthYear)} AS current_total_addition,
              ${totalDeductionExpr(prior)} AS previous_total_deduction, ${totalDeductionExpr(params.monthYear)} AS current_total_deduction,
              ${arExpr('presant_total', prior)} AS previous_ar_present, ${arExpr('presant_total', params.monthYear)} AS current_ar_present,
              ${arExpr('leave_total', prior)} AS previous_ar_leave, ${arExpr('leave_total', params.monthYear)} AS current_ar_leave,
              ${arExpr('holiday_total', prior)} AS previous_ar_holiday, ${arExpr('holiday_total', params.monthYear)} AS current_ar_holiday,
              ${arExpr('weekoff_total', prior)} AS previous_ar_weekoff, ${arExpr('weekoff_total', params.monthYear)} AS current_ar_weekoff,
              ${essLeaveExpr(prior)} AS previous_ess_leave, ${essLeaveExpr(params.monthYear)} AS current_ess_leave,
              ${variableCountExpr('Addition', prior)} AS previous_var_add_count, ${variableCountExpr('Addition', params.monthYear)} AS current_var_add_count,
              ${variableCountExpr('Deduction', prior)} AS previous_var_ded_count, ${variableCountExpr('Deduction', params.monthYear)} AS current_var_ded_count,
              pm.days_presant AS current_pm_days_presant, pm.days_leave AS current_pm_days_leave`;
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.payroll_master_pkey,
              pm.emp_fkey, pm.emp_name, ep.emp_company_id AS employee_id, uc.user_id AS login_user_id,
              pm.branch_name, pm.departments, pm.desig, ed.status,
              DATE_FORMAT(i.joining_date, '%Y-%m-%d') AS joining_date,
              DATE_FORMAT(tm.last_approved_working_date, '%Y-%m-%d') AS termination_date,${selectExtra},
              prev.days_presant AS previous_pm_days_presant, prev.days_leave AS previous_pm_days_leave,
              pm.bank_details AS current_bank_details_raw, prev.bank_details AS previous_bank_details_raw
       FROM payroll_master pm
       LEFT JOIN payroll_master prev ON prev.emp_fkey = pm.emp_fkey AND prev.month_year = ?
         AND prev.action IN ('Approved','Processed')
       LEFT JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
       LEFT JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
       LEFT JOIN user_credentials uc ON uc.emp_fkey = pm.emp_fkey
       LEFT JOIN employee_info i ON i.emp_pkey = pm.emp_fkey
       LEFT JOIN termination tm ON tm.emp_fkey = pm.emp_fkey AND tm.status = 1
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${statusCondition}${negativeCondition}
         AND ${conditions.join(' AND ')}
       ORDER BY pm.emp_name`,
      [...monthArgs, prior, params.monthYear, ...args]
    );

    const empFkeys = rows.map((r) => r.emp_fkey);
    const [itemLabels, currentItemValues, prevItemValues, prorateCodes] = await Promise.all([
      getComparisonItemLabels(pool, prior, params.monthYear),
      getComparisonItemValues(pool, empFkeys, params.monthYear),
      getComparisonItemValues(pool, empFkeys, prior),
      getProrateCodes(pool, empFkeys),
    ]);

    return rows.map((row) => {
      const curr = currentItemValues.get(row.emp_fkey);
      const prev = prevItemValues.get(row.emp_fkey);
      const items = itemLabels.map((label) => {
        const currentAmount = Math.round(Math.abs(curr?.get(label) ?? 0));
        const previousAmount = Math.round(Math.abs(prev?.get(label) ?? 0));
        return { label, current: currentAmount, previous: previousAmount, change: Math.abs(currentAmount - previousAmount) };
      });
      const previousNetActual = Number(row.previous_total_addition ?? 0) - Number(row.previous_total_deduction ?? 0);
      const currentNetActual = Number(row.current_total_addition ?? 0) - Number(row.current_total_deduction ?? 0);

      const prorateCode = prorateCodes.get(row.emp_fkey);
      const previousPayDays = computePayDays(prorateCode, {
        arPresent: Number(row.previous_ar_present ?? 0), arLeave: Number(row.previous_ar_leave ?? 0),
        arHoliday: Number(row.previous_ar_holiday ?? 0), arWeekoff: Number(row.previous_ar_weekoff ?? 0),
        essLeaveTotal: Number(row.previous_ess_leave ?? 0),
        pmDaysPresant: Number(row.previous_pm_days_presant ?? 0), pmDaysLeave: Number(row.previous_pm_days_leave ?? 0),
      });
      const currentPayDays = computePayDays(prorateCode, {
        arPresent: Number(row.current_ar_present ?? 0), arLeave: Number(row.current_ar_leave ?? 0),
        arHoliday: Number(row.current_ar_holiday ?? 0), arWeekoff: Number(row.current_ar_weekoff ?? 0),
        essLeaveTotal: Number(row.current_ess_leave ?? 0),
        pmDaysPresant: Number(row.current_pm_days_presant ?? 0), pmDaysLeave: Number(row.current_pm_days_leave ?? 0),
      });

      const previousVarAddCount = Number(row.previous_var_add_count ?? 0);
      const currentVarAddCount = Number(row.current_var_add_count ?? 0);
      const previousVarDedCount = Number(row.previous_var_ded_count ?? 0);
      const currentVarDedCount = Number(row.current_var_ded_count ?? 0);
      const previousBankDetails = cleanBankDetails(row.previous_bank_details_raw as string | null);
      const currentBankDetails = cleanBankDetails(row.current_bank_details_raw as string | null);

      // Row-level Status (comparison_report.ctp:334) — "No change" only if every metric below
      // matches between months; a single mismatch anywhere flags "Change identified".
      const noChange = previousVarAddCount === currentVarAddCount
        && previousVarDedCount === currentVarDedCount
        && previousBankDetails === currentBankDetails
        && Number(row.previous_ctc_standard ?? 0) === Number(row.current_ctc_standard ?? 0)
        && Number(row.previous_gross_standard ?? 0) === Number(row.current_gross_standard ?? 0)
        && items.every((item) => item.current === item.previous)
        && Number(row.previous_gross_actual ?? 0) === Number(row.current_gross_actual ?? 0)
        && previousNetActual === currentNetActual
        && Number(row.previous_ctc_actual ?? 0) === Number(row.current_ctc_actual ?? 0)
        && previousPayDays === currentPayDays;

      return {
        ...row,
        status: noChange ? 'No change' : 'Change identified',
        previous_net_actual: previousNetActual, current_net_actual: currentNetActual,
        net_actual_change: Math.abs(currentNetActual - previousNetActual),
        ctc_standard_change: Math.abs(Number(row.current_ctc_standard ?? 0) - Number(row.previous_ctc_standard ?? 0)),
        ctc_actual_change: Math.abs(Number(row.current_ctc_actual ?? 0) - Number(row.previous_ctc_actual ?? 0)),
        gross_standard_change: Math.abs(Number(row.current_gross_standard ?? 0) - Number(row.previous_gross_standard ?? 0)),
        gross_actual_change: Math.abs(Number(row.current_gross_actual ?? 0) - Number(row.previous_gross_actual ?? 0)),
        previous_pay_days: previousPayDays, current_pay_days: currentPayDays,
        pay_days_change: Math.abs(currentPayDays - previousPayDays),
        previous_var_add_count: previousVarAddCount, current_var_add_count: currentVarAddCount,
        var_add_status: previousVarAddCount === currentVarAddCount ? 'No change' : 'Change identified',
        previous_var_ded_count: previousVarDedCount, current_var_ded_count: currentVarDedCount,
        var_ded_status: previousVarDedCount === currentVarDedCount ? 'No change' : 'Change identified',
        previous_bank_details: previousBankDetails, current_bank_details: currentBankDetails,
        bank_status: previousBankDetails === currentBankDetails ? 'No change' : 'Change identified',
        items,
      };
    });
  }

  if (params.subtype === 'MonthlyCTCReport') {
    // Mirrors generateEmpMonthlyCTCReport() (SalaryReportsController.php:12948-13369). Unlike every
    // other report on this screen, legacy's real UI here (monthlyctc.ctp + its own Excel branch) is
    // a per-employee CARD layout — a legend block (Name/EMP ID/Branch/Designation/Department), a
    // "Salary Components / Amount" mini-table of Addition-only items, and a per-employee Grand
    // Total — not a flat pivoted table, matching the Salary Slip report's shape rather than this
    // screen's usual SUBTYPE_META-driven grid (see MonthlyCtcCard in page.tsx). Also legacy-specific
    // to this report: only Addition-side items are shown at all (this is a CTC report — no
    // deductions), zero-amount items are skipped, and no item_part='Direct' filter is applied
    // (every other report on this screen filters to Direct — this one genuinely doesn't).
    const statusCondition = params.includeResigned ? 'ed.status IN (1,2)' : 'ed.status = 1';
    const negativeCondition = params.includeNegative ? '' : ' AND pm.net_salary >= 0';
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.payroll_master_pkey, pm.emp_fkey,
              CASE WHEN ed.status = 2 THEN CONCAT(ed.first_name, ' ', ed.last_name, ' (Resigned)')
                   ELSE CONCAT(ed.first_name, ' ', ed.last_name) END AS emp_name,
              ep.emp_company_id AS employee_id, pm.branch_name, pm.departments, pm.desig
       FROM payroll_master pm
       JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
       LEFT JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${statusCondition}${negativeCondition}
         AND EXISTS (SELECT 1 FROM emp_salary_slip ess WHERE ess.payroll_master_fkey = pm.payroll_master_pkey
                       AND ess.head_operator = 'Addition' AND ess.salary_amount <> 0 AND ess.end_date_effective IS NULL)
         AND ${conditions.join(' AND ')}
       ORDER BY pm.branch_name, emp_name`,
      [params.monthYear, ...args]
    );

    const pkeys = rows.map((r) => r.payroll_master_pkey);
    const itemsMap = new Map<number, { label: string; amount: number; headType: string | null }[]>();
    if (pkeys.length > 0) {
      const [itemRows] = await pool.query<RowDataPacket[]>(
        `SELECT ess.payroll_master_fkey, TRIM(ess.salary_head_item_desc) AS label, ess.salary_amount, ess.head_type
         FROM emp_salary_slip ess
         LEFT JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
         WHERE ess.payroll_master_fkey IN (?) AND ess.head_operator = 'Addition' AND ess.salary_amount <> 0
           AND ess.end_date_effective IS NULL
         ORDER BY shi.salary_head_item_order1`,
        [pkeys]
      );
      for (const r of itemRows as RowDataPacket[]) {
        const list = itemsMap.get(r.payroll_master_fkey) ?? [];
        list.push({ label: String(r.label), amount: Number(r.salary_amount), headType: r.head_type ? String(r.head_type).toLowerCase() : null });
        itemsMap.set(r.payroll_master_fkey, list);
      }
    }

    return rows.map((row) => {
      const items = itemsMap.get(row.payroll_master_pkey) ?? [];
      const grandTotal = Math.round(items.reduce((s, i) => s + i.amount, 0));
      return { ...row, items, grand_total: grandTotal };
    });
  }

  if (params.subtype === 'PayrollCTC') {
    // Mirrors generatePayrollCTC() (SalaryReportsController.php:22569-23327). Legacy's own on-screen
    // View/PDF for this report are dead code (payroll_ctc.ctp expects $gross/$array_key/$standard_key/
    // $variable_key/$stdctc_key/$actualctc_key — variables generatePayrollCTC() never $this->set(),
    // confirmed by grep against every other report function in this controller, which all do) — only
    // the Excel branch (built directly off $arr_emp_details via raw PHPExcel calls, lines 23048-23254)
    // actually works, so this is Excel-only (see viewAllowed:false in page.tsx). Each employee is
    // categorized into 5 item groups, each independently scoped to the month (not the selected
    // criteria, so the column set is stable across rows — same discipline as getSalaryHeadKeys):
    // Standard (head_pkey IN (1,5), split Addition/Deduction), Variable (head_pkey IN (2,7,9), not
    // split), Employer Contribution (item_part='Indirect' AND head_pkey=4, not split), Actual
    // Addition/Deduction (item_part='Direct' AND head_type IN ('Manually','Fixed') AND head_pkey NOT
    // IN (1,2,5,7,9) OR NULL, split by head_operator — deliberately allows no head classification at
    // all, unlike every other pivot on this screen which inner-joins salary_heads).
    const statusCondition = params.includeResigned ? 'ed.status IN (1,2)' : 'ed.status = 1';
    const negativeCondition = params.includeNegative ? '' : ' AND pm.net_salary >= 0';
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'ed.branch_code', EmployeeDetails: 'ar.emp_fkey',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT ar.emp_fkey, ei.employee_id AS employee_id, uc.user_id AS login_user_id,
              CASE WHEN ed.status = 2 THEN CONCAT(ei.EmpName, ' (Resigned)') ELSE ei.EmpName END AS emp_name,
              CASE WHEN ed.classification = 'male' THEN 'Male' WHEN ed.classification = 'female' THEN 'Female'
                   WHEN ed.classification = 'Other' THEN 'Transgender' ELSE ed.classification END AS gender,
              ar.month_year AS month_year, ei.designation AS desig, ei.department AS departments, ei.branch AS branch_name,
              DATE_FORMAT(ei.joining_date, '%d-%m-%Y') AS joining_date,
              DATE_FORMAT(tm.last_approved_working_date, '%d-%m-%Y') AS termination_date,
              ar.presant_total AS present_days, ROUND(ot.total_duration / 60, 2) AS overtime_hours,
              ar.lop_total AS lop_days, ar.leave_total AS leave_days, ar.weekoff_total AS weekoff_total, ar.holiday_total AS holiday_total
       FROM attendance_register ar
       LEFT JOIN emp_details ed ON ar.emp_fkey = ed.emp_pkey
       LEFT JOIN employee_info ei ON ed.emp_pkey = ei.emp_pkey
       LEFT JOIN emp_ot_master ot ON ar.emp_fkey = ot.emp_fkey AND DATE_FORMAT(ot.month, '%Y-%m') = LEFT(ar.month_year, 7)
       LEFT JOIN termination tm ON ar.emp_fkey = tm.emp_fkey AND tm.status = 1
       LEFT JOIN payroll_master pm ON pm.emp_fkey = ar.emp_fkey AND pm.month_year = ar.month_year
       LEFT JOIN user_credentials uc ON uc.emp_fkey = ar.emp_fkey
       WHERE ar.isdelete = 'N' AND ar.month_year = ? AND ar.record_status = '1' AND pm.action IN ('Approved','Processed')
         AND ${statusCondition}${negativeCondition} AND ${conditions.join(' AND ')}
       ORDER BY ei.EmpName`,
      [params.monthYear, ...args]
    );
    const keys = await getPayrollCtcKeys(pool, params.monthYear);
    const empFkeys = rows.map((r) => r.emp_fkey as number);
    const valuesMap = await getPayrollCtcValues(pool, empFkeys, params.monthYear);
    return rows.map((row) => {
      const empValues = valuesMap.get(row.emp_fkey as number);
      return {
        ...row,
        standard_additions: buildPayrollCtcItems(keys.standardAdditions, empValues),
        standard_deductions: buildPayrollCtcItems(keys.standardDeductions, empValues),
        variable_result: buildPayrollCtcItems(keys.variable, empValues),
        employer_result: buildPayrollCtcItems(keys.employer, empValues),
        actual_addition_result: buildPayrollCtcItems(keys.actualAddition, empValues),
        actual_deduction_result: buildPayrollCtcItems(keys.actualDeduction, empValues),
      };
    });
  }

  // SummaryPayroll (default)
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
  });
  // Mirrors legacy's $condition (status filter, SalaryReportsController.php:11854-11858) and the
  // PSQUARE variant's negative-salary filter (:29842-29846) — applied uniformly here rather than
  // only for the 3 PSQUARE companies, since the standard variant leaving it unfiltered is a legacy
  // bug, not intended behavior (see reports.ts SummaryPayroll follow-up note / migration plan).
  const statusCondition = params.includeResigned ? 'ed.status IN (1,2)' : 'ed.status = 1';
  const negativeCondition = params.includeNegative ? '' : ' AND pm.net_salary >= 0';
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT pm.emp_fkey,
            CASE WHEN ed.status = 2 THEN CONCAT(pm.emp_name, ' (Resigned)') ELSE pm.emp_name END AS emp_name,
            ep.emp_company_id AS employee_id, uc.user_id AS login_user_id, pm.branch_name,
            pm.departments, pm.desig, pm.month_year,
            DATE_FORMAT(i.joining_date, '%Y-%m-%d') AS joining_date,
            DATE_FORMAT(tm.last_approved_working_date, '%Y-%m-%d') AS termination_date,
            pm.days_presant, pm.days_leave, pm.loss_of_pay, pm.working_days, ar.weekoff_total, ar.holiday_total,
            pm.monthly_ctc,
            COALESCE((SELECT ROUND(SUM(ess.salary_rate)) FROM emp_salary_slip ess
                      WHERE ess.emp_fkey = pm.emp_fkey AND ess.month_year = pm.month_year AND ess.end_date_effective IS NULL
                        AND LOWER(ess.head_operator) = 'addition' AND LOWER(ess.item_part) = 'direct'), 0) AS standard_gross_salary,
            pm.gross_salary, pm.total_deduction, pm.total_variables,
            COALESCE((SELECT SUM(ess.salary_amount) FROM emp_settle_slip ess
                      WHERE ess.emp_fkey = pm.emp_fkey AND ess.status = 'Y' AND ess.approved = 'Y' AND ess.type <> 'SALARY'
                        AND DATE_FORMAT(tm.last_approved_working_date, '%Y-%m') = pm.month_year), 0) AS settlement_amount,
            (pm.net_salary + COALESCE((SELECT SUM(ess.salary_amount) FROM emp_settle_slip ess
                      WHERE ess.emp_fkey = pm.emp_fkey AND ess.status = 'Y' AND ess.approved = 'Y' AND ess.type <> 'SALARY'
                        AND DATE_FORMAT(tm.last_approved_working_date, '%Y-%m') = pm.month_year), 0)) AS net_salary,
            CASE WHEN pm.action = 'Approved' THEN 'Yes' ELSE 'No' END AS approved_label
     FROM payroll_master pm
     LEFT JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
     LEFT JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
     LEFT JOIN user_credentials uc ON uc.emp_fkey = pm.emp_fkey
     LEFT JOIN employee_info i ON i.emp_pkey = pm.emp_fkey
     LEFT JOIN termination tm ON tm.emp_fkey = pm.emp_fkey AND tm.status = 1
     LEFT JOIN attendance_register ar ON ar.emp_fkey = pm.emp_fkey AND ar.month_year = pm.month_year
     WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${statusCondition}${negativeCondition} AND ${conditions.join(' AND ')}
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
  // Legacy's PDF (salaryslip_not_exempted.ctp:942-955) shows these as two distinct fields:
  // "Non Paying Days" (payroll_master.loss_of_pay) and "LOP Days" (attendance_register.lop_only) —
  // not the same value. An earlier port conflated them (lop_days was populated from loss_of_pay).
  non_paying_days: number;
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
  settlement_amount: number;
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
            i.branch AS branch_name, DATE_FORMAT(i.joining_date, '%Y-%m-%d') AS joining_date, ed.status, ed.classification AS gender,
            pm.days_leave, pm.loss_of_pay, pm.bank_details,
            ar.presant_total, ar.weekoff_total, ar.holiday_total, ar.lop_only,
            ed.company_pf, ed.esi, ed.pf AS uan,
            ed.bank_name AS ed_bank_name, ed.branch_name AS ed_bank_branch, ed.ifsc_code AS ed_ifsc_code,
            ed.account_no AS ed_account_no,
            ep.emp_company_id AS employee_id, uc.user_id AS login_user_id,
            DATE_FORMAT(tm.last_approved_working_date, '%Y-%m-%d') AS termination_date,
            COALESCE((SELECT SUM(ess.salary_amount) FROM emp_settle_slip ess
                      WHERE ess.emp_fkey = pm.emp_fkey AND ess.status = 'Y' AND ess.approved = 'Y' AND ess.type <> 'SALARY'
                        AND DATE_FORMAT(tm.last_approved_working_date, '%Y-%m') = pm.month_year), 0) AS settlement_amount
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
    const earningItems = items.filter((i) => i.head_operator === 'Addition');
    const deductionItems = items.filter((i) => i.head_operator !== 'Addition');
    // Legacy nudges the first earnings line by the total rounding delta (salaryslip_not_exempted.ctp:
    // 1033-1040) so displayed earnings sum exactly to the displayed Total Earnings instead of
    // drifting by a rupee from independently-rounded line items.
    const earningValues = earningItems.map((i) => Math.abs(Number(i.salary_amount)));
    const ogTotal = earningValues.reduce((s, v) => s + Math.round(v * 100) / 100, 0);
    const rndTotal = earningValues.reduce((s, v) => s + Math.round(v), 0);
    const diff = Math.round(ogTotal) - rndTotal;
    const earnings: SalarySlipLineItem[] = earningItems.map((item, m) => ({
      label: String(item.salary_head_item_desc).trim(),
      amount: Math.round(earningValues[m]) + (m === 0 ? diff : 0),
      rate: Math.abs(Math.round(Number(item.structure_det_value ?? item.salary_amount))),
    }));
    const deductions: SalarySlipLineItem[] = deductionItems.map((item) => ({
      label: String(item.salary_head_item_desc).trim(),
      amount: Math.abs(Math.round(Number(item.salary_amount))),
      rate: Math.abs(Math.round(Number(item.structure_det_value ?? item.salary_amount))),
    }));
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
      non_paying_days: row.loss_of_pay ?? 0,
      lop_days: row.lop_only ?? 0,
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
      settlement_amount: Number(row.settlement_amount),
      net_pay: Math.round(totalEarnings - totalDeductions + Number(row.settlement_amount)),
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
            DATE_FORMAT(t.att_date, '%Y-%m-%d') AS att_date, t.others, t.leaves,
            DATE_FORMAT(tm.last_approved_working_date, '%Y-%m-%d') AS last_approved_working_date
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
