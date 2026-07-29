import type { Pool, RowDataPacket } from 'mysql2/promise';
import { requireCriteria, buildCriteriaConditions, type CriteriaSelections } from './reports';

// Ports EmployeeLoanReportsController::generateemployeeeloan() and
// EmployeeAdvanceReportsController::generateemployeeadvance() — both confirmed via source read to
// be single-report-type screens (reporttype 'Loan'/'Advance'), each offering exactly one real
// report despite the generic hrreports()/generatereport() dispatcher shape used everywhere else in
// this module. `get_branch_code_abs_fn`/`get_directors_branch_code` (used only in legacy's
// criteria-dropdown population, not the report query itself) are gated to company codes GLET/ABSG/
// GAAR/HRBL — GRTL is none of these, so a plain `branch_code = ?` filter (already this project's
// standard Units-criteria mapping) is a confirmed-safe substitute, not an approximation.

export interface LoanReportParams {
  fromMonth: string; // 'YYYY-MM'
  toMonth: string;
  includeResigned: boolean;
  includeCompleted: boolean;
  criteria: CriteriaSelections;
}

// Mirrors generateemployeeeloan() — filters by emp_loan.created_date (loan creation date), NOT the
// EMI schedule dates. `balance_amount` = loan_amount − SUM(amount_paid) across the EMI schedule
// (legacy computes the same figure but via an overloaded/misleadingly-named `remarks` PHP array
// key — reproduced here as a clearly-named `balance_amount` column instead).
export async function generateLoanReport(pool: Pool, params: LoanReportParams) {
  requireCriteria(params.criteria);
  const statusClause = params.includeResigned ? `ed.status IN (1,2)` : `ed.status = 1`;
  const completedClause = params.includeCompleted ? '' : `AND el.is_completed = 'N'`;
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'ed.branch_code', EmployeeDetails: 'ed.emp_pkey',
  });
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT el.emp_loan_pkey, ed.emp_pkey, i.EmpName AS emp_name, i.employee_id, i.branch, i.department,
            i.designation, i.joining_date, tm.last_approved_working_date AS termination_date,
            el.loan_amount, el.tenure, el.intrest_rate, el.emi_amount, el.emi_start_month, el.emi_end_month,
            el.is_completed,
            COALESCE((SELECT SUM(amount_paid) FROM emp_loan_info WHERE loan_pkey = el.emp_loan_pkey), 0) AS paid,
            el.loan_amount - COALESCE((SELECT SUM(amount_paid) FROM emp_loan_info WHERE loan_pkey = el.emp_loan_pkey), 0) AS balance_amount
     FROM emp_loan el
     JOIN emp_details ed ON ed.emp_pkey = el.emp_fkey
     LEFT JOIN employee_info i ON i.emp_pkey = ed.emp_pkey
     LEFT JOIN termination tm ON tm.emp_fkey = ed.emp_pkey AND tm.status = 1
     WHERE el.status = 1 AND el.created_date >= CONCAT(?, '-01')
       AND el.created_date < DATE_ADD(LAST_DAY(CONCAT(?, '-01')), INTERVAL 1 DAY)
       ${completedClause} AND ${statusClause} AND ${conditions.join(' AND ')}
     ORDER BY i.EmpName`,
    [params.fromMonth, params.toMonth, ...args]
  );
  return rows;
}

export interface AdvanceReportParams {
  monthYear: string; // 'YYYY-MM' — legacy is single-month only for this report, despite offering a "to" field it never actually applies
  includeResigned: boolean;
  criteria: CriteriaSelections;
}

// Mirrors generateemployeeadvance() — single-month filter on affected_month, always excludes
// already-credited advances (matches legacy's hardcoded `is_credited='N'`, not a UI toggle there).
export async function generateAdvanceReport(pool: Pool, params: AdvanceReportParams) {
  requireCriteria(params.criteria);
  const statusClause = params.includeResigned ? `ed.status IN (1,2)` : `ed.status = 1`;
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'ed.branch_code', EmployeeDetails: 'ed.emp_pkey',
  });
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ea.emp_advance_pkey, ed.emp_pkey, i.EmpName AS emp_name, i.employee_id, i.branch, i.department,
            i.designation, i.joining_date, tm.last_approved_working_date AS termination_date,
            ea.advance_amount, ea.affected_month, ea.created_date, ea.modified_date, ea.remarks
     FROM emp_advance ea
     JOIN emp_details ed ON ed.emp_pkey = ea.emp_fkey
     LEFT JOIN employee_info i ON i.emp_pkey = ed.emp_pkey
     LEFT JOIN termination tm ON tm.emp_fkey = ed.emp_pkey AND tm.status = 1
     WHERE ea.status = 1 AND ea.is_credited = 'N' AND ea.affected_month = ?
       AND ${statusClause} AND ${conditions.join(' AND ')}
     ORDER BY i.EmpName`,
    [params.monthYear, ...args]
  );
  return rows;
}
