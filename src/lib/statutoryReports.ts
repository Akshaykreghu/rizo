import type { Pool, RowDataPacket } from 'mysql2/promise';
import { requireCriteria, buildCriteriaConditions, type CriteriaSelections } from './reports';
import { FIELD_COLUMNS } from './attendance';

// Ports the GRTL-relevant slice of Statutory Reports. Two live controllers researched:
// `StatutoryReportController.php` (confirmed the real, routed one — `statutoryReportsController.php`
// lowercase-plural is dead/unrouted code) for EPF/ESI/ProfTax, and `StatutoryRegistersController.php`
// for the Wage Sheet register. Deliberately NOT ported in this pass: `EsiEpfReportController`'s
// e-filing "Statutory Upload" screen (epf_member_reg/epf_exit/epf_contr/esi_contr/epf_upload —
// generates government e-filing files, a different feature shape than a tabular report; wps_template
// is Gulf/Middle-East payroll compliance, irrelevant for GRTL/India), the SYNTHIET-tenant-branded EPF/
// ESI variants (~2000 lines of another tenant's custom code), the KWMT/GLET/DEMO-only Professional Tax
// variant (GRTL uses the plain path), and 12BB. ServiceRecord (Form BB-style single-employee
// compliance document, confirmed via research to be a key/value form layout rather than a
// tabular report, built from raw SQL against a previously-unseen `tax_salary_components` table
// not yet verified live) is deferred as lower value relative to effort — it's a genuinely
// different UI shape (one printable form per employee, not a results table) than everything else
// in this module. Musterroll IS ported below.
//
// Real, deliberate simplification vs. legacy for EPF/ESI: legacy's EsiEpfReportController computes a
// "PF-eligible base" by eval()-ing a pure-arithmetic string stored in emp_salary_slip.remarks (e.g.
// "6500*.12") at report time — confirmed via source read this string is always pre-computed,
// numeric-only arithmetic (payroll's own code gates it with a numeric-only regex before ever writing
// it), not a symbolic formula. Rather than port a string-eval step (fragile, and an unnecessary
// mini-interpreter for something with a direct SQL answer), this report reads the real EPF/ESI
// employee+employer contribution amounts directly from `emp_salary_slip` (already computed by
// payroll processing — this project's standing discipline is to read computed results, not
// re-derive statutory math). Matched by `salary_head_items.item` text ('EPF - Employee
// Contribution' etc, confirmed live — 4 real rows, head_fkey 4=Employer/5=Employee) rather than
// legacy's fragile `LIKE '%pf%'` matching against a much noisier set of head descriptions.

export interface StatutoryPeriodParams {
  monthYear: string; // 'YYYY-MM'
  criteria: CriteriaSelections;
}

async function generateContributionReport(pool: Pool, params: StatutoryPeriodParams, itemPattern: string) {
  requireCriteria(params.criteria);
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
  });
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT pm.emp_fkey, pm.emp_name, pm.branch_name,
            COALESCE(SUM(CASE WHEN shi.head_fkey = 5 THEN -ess.salary_amount END), 0) AS employee_contribution,
            COALESCE(SUM(CASE WHEN shi.head_fkey = 4 THEN ess.salary_amount END), 0) AS employer_contribution
     FROM emp_salary_slip ess
     JOIN payroll_master pm ON pm.payroll_master_pkey = ess.payroll_master_fkey
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
     WHERE ess.month_year = ? AND ess.end_date_effective IS NULL AND shi.item LIKE ?
       AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
     GROUP BY pm.emp_fkey, pm.emp_name, pm.branch_name
     ORDER BY pm.emp_name`,
    [params.monthYear, itemPattern, ...args]
  );
  return rows;
}

// Mirrors generateEPFlabourreport() — EPF employee + employer contribution per employee.
export function generateEpfReport(pool: Pool, params: StatutoryPeriodParams) {
  return generateContributionReport(pool, params, '%EPF%');
}

// Mirrors generateESIlabourreport() — ESI employee + employer contribution per employee.
export function generateEsiReport(pool: Pool, params: StatutoryPeriodParams) {
  return generateContributionReport(pool, params, '%ESI%');
}

export interface ProfTaxParams {
  fromMonth: string; // 'YYYY-MM'
  toMonth: string;
  criteria: CriteriaSelections;
}

// Mirrors generateprofessionaltaxreport() (GRTL's non-KWMT/GLET/DEMO path). Legacy presents this
// as a "1st half / 2nd half of the financial year" toggle, computed via PHP date math off the open
// fin_year row — deliberately simplified here to a plain from/to month range (same UX pattern
// already used for the other true-date-range reports in this module, e.g. Gross Salary Period-Wise)
// rather than replicating the half-year toggle UI.
export async function generateProfTaxReport(pool: Pool, params: ProfTaxParams) {
  requireCriteria(params.criteria);
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
  });
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT pm.emp_fkey, pm.emp_name, pm.branch_name, ess.month_year,
            -ess.salary_amount AS professional_tax
     FROM emp_salary_slip ess
     JOIN payroll_master pm ON pm.payroll_master_pkey = ess.payroll_master_fkey
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
     WHERE ess.month_year BETWEEN ? AND ? AND ess.end_date_effective IS NULL
       AND shi.item = 'Professional Tax'
       AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
     ORDER BY pm.emp_name, ess.month_year`,
    [params.fromMonth, params.toMonth, ...args]
  );
  return rows;
}

// Mirrors StatutoryRegistersController::Generatewage() — a wage-sheet register of Direct-part
// salary head items only (excludes Indirect/employer-side and Admin-only heads), per real
// item_part values confirmed live.
export async function generateWageSheetReport(pool: Pool, params: StatutoryPeriodParams) {
  requireCriteria(params.criteria);
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'pm.branch_code', EmployeeDetails: 'pm.emp_fkey',
  });
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT pm.emp_fkey, pm.emp_name, pm.branch_name, shi.item AS salary_head, ess.salary_amount
     FROM emp_salary_slip ess
     JOIN payroll_master pm ON pm.payroll_master_pkey = ess.payroll_master_fkey
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = ess.salary_head_item_fkey
     WHERE ess.month_year = ? AND ess.end_date_effective IS NULL AND shi.item_part = 'Direct'
       AND pm.action IN ('Approved','Processed') AND ${conditions.join(' AND ')}
     ORDER BY pm.emp_name, shi.salary_head_item_order1`,
    [params.monthYear, ...args]
  );
  return rows;
}

export interface MusterRollParams {
  monthYear: string;
  includeResigned: boolean;
  criteria: CriteriaSelections;
}

// Mirrors generatemusterrollreport() — a labour-law compliance register: per-employee day-by-day
// attendance (not wage data, despite living on the same "Statutory Registers" screen as Wage
// Sheet), sourced from `attendance_register`'s FIELD1..FIELD32 day columns + its precomputed
// summary totals. Deliberately does NOT replicate legacy's side-effecting insert_update_att_reg
// call at report time — reads the already-populated register, matching this project's established
// boundary (reports read, they don't process) already applied to the Attendance Register report.
export async function generateMusterRollReport(pool: Pool, params: MusterRollParams) {
  requireCriteria(params.criteria);
  const statusClause = params.includeResigned ? `ed.status IN (1,2)` : `ed.status = 1`;
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'ar.branch_code', EmployeeDetails: 'ar.emp_fkey',
  });
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ar.emp_fkey, ar.emp_name, ed.guradian AS guardian_name, i.designation, i.department,
            b.branch_name, i.joining_date, tm.last_approved_working_date AS termination_date,
            ar.presant_total, ar.leave_total, ar.weekoff_total, ar.holiday_total, ar.lop_total,
            ${FIELD_COLUMNS.map((c) => `ar.${c}`).join(', ')}
     FROM attendance_register ar
     JOIN emp_details ed ON ed.emp_pkey = ar.emp_fkey
     LEFT JOIN employee_info i ON i.emp_pkey = ar.emp_fkey
     LEFT JOIN branches b ON b.branch_code = ar.branch_code
     LEFT JOIN termination tm ON tm.emp_fkey = ar.emp_fkey AND tm.status = 1
     WHERE ar.month_year = ? AND ar.isdelete = 'N' AND ${statusClause} AND ${conditions.join(' AND ')}
     ORDER BY ar.emp_name`,
    [params.monthYear, ...args]
  );
  return rows;
}
