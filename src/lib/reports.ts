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
  includeResigned?: boolean; // SummaryPayroll/salary/Grosssalary/BankTranfer — "Include Resigned" checkbox
  includeNegative?: boolean; // SummaryPayroll/Grosssalary/BankTranfer — "Include Negative Salary" checkbox
}

function prevMonth(monthYear: string): string {
  const [y, m] = monthYear.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Legacy's GrosssalaryNew/PayrollCTC/Comparison views pivot each employee's real salary-head items
// (Basic, HRA, Conveyance, etc — varies per company/employee) into their own columns, alongside the
// fixed aggregate totals already ported. Fetches the Addition-side items actually processed this
// month from `emp_salary_slip` (the same source the aggregate standard/variable totals already draw
// from via head_pkey category — this is that same data at per-item grain instead of summed).
// Deliberately does NOT also pivot a parallel "Standard Salary" (structure-value) column set the way
// legacy's HTML does for these 3 reports — documented simplification, not silently dropped. (The
// plain `Grosssalary` report DOES get the full Standard+Actual pivot — see getSalaryHeadKeys/
// getGrossPivot below — because legacy's actual Net Salary computation for that report depends on
// it, unlike these three, which read a pre-aggregated total from payroll_master.)
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
              DATE_FORMAT(i.joining_date, '%Y-%m-%d') AS joining_date,
              DATE_FORMAT(tm.last_approved_working_date, '%Y-%m-%d') AS termination_date,
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
              DATE_FORMAT(i.joining_date, '%Y-%m-%d') AS joining_date,
              DATE_FORMAT(tm.last_approved_working_date, '%Y-%m-%d') AS termination_date,
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
              DATE_FORMAT(i.joining_date, '%Y-%m-%d') AS joining_date,
              DATE_FORMAT(tm.last_approved_working_date, '%Y-%m-%d') AS termination_date,
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
