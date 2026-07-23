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
  const [rows] = await pool.execute<ReportCriteriaRow[]>(
    `SELECT reportcriteria, reportcriteria_desc, reportcriteria_field
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

function requireCriteria(criteria: CriteriaSelections) {
  const hasAny = Object.values(criteria).some((v) => Array.isArray(v) && v.length > 0);
  if (!hasAny) throw new CriteriaRequiredError();
}

function buildCriteriaConditions(criteria: CriteriaSelections, fieldMap: Record<string, string>) {
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
}

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
      `SELECT ed.emp_pkey, i.EmpName AS emp_name, i.branch, i.department, i.designation,
              ct.emp_anual_ctc, ct.emp_derived_anualctc, ct.start_date_effective, ct.next_increment_date
       FROM emp_details ed
       JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
       JOIN emp_ctc_transaction ct ON ct.emp_fkey = ed.emp_pkey AND ct.end_date_effective IS NULL
       LEFT JOIN employee_info i ON i.emp_pkey = ed.emp_pkey
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
      `SELECT pm.emp_fkey, pm.emp_name, pm.branch_name, pm.departments, pm.desig, pm.month_year,
              pm.gross_salary, pm.total_deduction, pm.total_variables, pm.net_salary
       FROM payroll_master pm
       JOIN emp_proff ep ON ep.emp_fkey = pm.emp_fkey
       JOIN emp_details ed ON ed.emp_pkey = pm.emp_fkey
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
       ORDER BY pm.emp_name`,
      [params.monthYear, ...args]
    );
    return rows;
  }

  if (params.subtype === 'BankTranfer') {
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.emp_fkey, pm.emp_name, pm.branch_name, pm.month_year, pm.bank_details, pm.net_salary
       FROM payroll_master pm
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
       ORDER BY pm.emp_name`,
      [params.monthYear, ...args]
    );
    return rows;
  }

  if (params.subtype === 'Salaryslip') {
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.payroll_master_pkey, pm.emp_fkey, pm.emp_name, pm.branch_name, pm.month_year,
              pm.gross_salary, pm.total_deduction, pm.net_salary, pm.bank_details
       FROM payroll_master pm
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
       ORDER BY pm.emp_name`,
      [params.monthYear, ...args]
    );
    return rows;
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
      `SELECT pm.emp_fkey, pm.emp_name, pm.branch_name, pm.departments, pm.desig, pm.month_year,
              pm.gross_salary, pm.net_salary,
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
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
       ORDER BY pm.emp_name`,
      [params.monthYear, ...args]
    );
    return rows;
  }

  if (params.subtype === 'GrosssalarySummary') {
    // Mirrors GenerateSalaryGrossSummary() — a branch-level aggregation rather than a per-employee
    // row (the "Summary" distinction from Grosssalary's per-employee detail).
    const { conditions, args } = buildCriteriaConditions(params.criteria, { Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey' });
    // GROUP BY branch_code only — payroll_master.branch_name is a denormalized copy that's
    // inconsistently NULL on some real rows (confirmed live), which would otherwise split one
    // branch into two summary rows. MAX() picks up whichever row has the name populated.
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.branch_code, MAX(pm.branch_name) AS branch_name, COUNT(*) AS employee_count,
              SUM(pm.gross_salary) AS total_gross, SUM(pm.total_deduction) AS total_deductions,
              SUM(pm.net_salary) AS total_net
       FROM payroll_master pm
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
       GROUP BY pm.branch_code
       ORDER BY branch_name`,
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
      `SELECT pm.emp_fkey, pm.emp_name, pm.branch_name, pm.month_year,
              pm.gross_salary, pm.total_deduction, pm.net_salary
       FROM payroll_master pm
       WHERE pm.month_year BETWEEN ? AND ? AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
       ORDER BY pm.emp_name, pm.month_year`,
      [params.monthYear, toMonth, ...args]
    );
    return rows;
  }

  if (params.subtype === 'Comparison') {
    // Mirrors GenerateSalaryComparison() — compares the selected month against the prior
    // calendar month, computed server-side (legacy: DateTime::modify('-1 month')), not a
    // user-picked second date.
    const prior = prevMonth(params.monthYear);
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.emp_fkey, pm.emp_name, pm.branch_name,
              pm.net_salary AS current_net, prev.net_salary AS previous_net,
              (pm.net_salary - COALESCE(prev.net_salary, 0)) AS net_change
       FROM payroll_master pm
       LEFT JOIN payroll_master prev ON prev.emp_fkey = pm.emp_fkey AND prev.month_year = ?
         AND prev.action IN ('Approved','Processed')
       WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
       ORDER BY pm.emp_name`,
      [prior, params.monthYear, ...args]
    );
    return rows;
  }

  if (params.subtype === 'MonthlyCTCReport') {
    // Mirrors generateEmpMonthlyCTCReport() — per-employee, per-salary-head-item detail (a long
    // format breakdown, not a pivoted summary), sourced from emp_salary_slip.
    const { conditions, args } = buildCriteriaConditions(params.criteria, {
      Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
    });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT pm.emp_fkey, pm.emp_name, pm.branch_name, pm.desig, pm.month_year,
              shi.item AS salary_head, ess.salary_amount
       FROM emp_salary_slip ess
       JOIN payroll_master pm ON pm.payroll_master_pkey = ess.payroll_master_fkey
       JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
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
      `SELECT pm.emp_fkey, pm.emp_name, pm.branch_name, pm.month_year,
              COALESCE(SUM(CASE WHEN sh.head_pkey IN (1,5) THEN ess.salary_amount END), 0) AS standard_total,
              COALESCE(SUM(CASE WHEN sh.head_pkey IN (2,7,9) THEN ess.salary_amount END), 0) AS variable_total,
              COALESCE(SUM(CASE WHEN sh.head_pkey = 4 THEN ess.salary_amount END), 0) AS employer_total,
              COALESCE(SUM(CASE WHEN sh.head_pkey NOT IN (1,2,4,5,7,9) THEN ess.salary_amount END), 0) AS other_total,
              pm.net_salary
       FROM emp_salary_slip ess
       JOIN payroll_master pm ON pm.payroll_master_pkey = ess.payroll_master_fkey
       JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
       JOIN salary_heads sh ON sh.head_pkey = shi.head_fkey
       WHERE ess.month_year = ? AND ess.end_date_effective IS NULL
         AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
       GROUP BY pm.emp_fkey, pm.emp_name, pm.branch_name, pm.month_year, pm.net_salary
       ORDER BY pm.emp_name`,
      [params.monthYear, ...args]
    );
    return rows;
  }

  // SummaryPayroll (default)
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
  });
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT pm.emp_fkey, pm.emp_name, pm.branch_name, pm.departments, pm.desig, pm.month_year,
            pm.days_presant, pm.days_leave, pm.loss_of_pay, pm.working_days,
            pm.monthly_ctc, pm.gross_salary, pm.total_deduction, pm.total_variables, pm.net_salary, pm.approved
     FROM payroll_master pm
     WHERE pm.month_year = ? AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
     ORDER BY pm.emp_name`,
    [params.monthYear, ...args]
  );
  return rows;
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
