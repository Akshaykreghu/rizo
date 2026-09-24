import type { Pool, RowDataPacket } from 'mysql2/promise';
import { requireCriteria, buildCriteriaConditions, type CriteriaSelections } from './reports';

// Ports MiscellaniousReportsController::generateleavebalancereportnew() — the "Leave Balance
// Report" under Miscellaneous Reports. Legacy's real function is ~1400 lines with a separate query
// branch per criteria dimension (LeaveType / Departments / EmployeeDetails / Units-implicit-else),
// plus resigned-employee variants, leave-encashment sums, and termination joins. Per explicit scope
// decision, this port only supports the EmployeeDetails and Units (branch) criteria dimensions —
// the two legacy branches confirmed to share the same per-employee/per-leave-type row shape and
// getLeaveCycle() cycle math — and only active (status=1) employees, no encashment/termination
// columns. LeaveType and Departments criteria are not offered here.

export interface LeaveBalanceReportParams {
  asOfDate: string; // 'YYYY-MM-DD' — legacy's $from (first of the selected report month)
  criteria: CriteriaSelections;
}

interface LeavePolicyRow extends RowDataPacket {
  salary_head_item_fkey: number;
  leave_cycle_start_date: string | null;
  leave_cycle_end_date: string | null;
  leave_policy_type: string;
  dynamic_period: number | null;
}

interface EmployeeRow extends RowDataPacket {
  emp_pkey: number;
  LEAVEPOLICY_GROUP_ID: number;
}

// Ports getLeaveCycle() — resolves the leave-policy cycle window (start/end) containing
// `selectedDate`, per policy type: Y/P (yearly, same rule), M (monthly), Q (quarterly),
// H (half-yearly), D (dynamic rolling window). Falls back to the raw cycleStart/cycleEnd for any
// other type, matching legacy's `default: break`.
function getLeaveCycle(
  policyType: string,
  cycleStart: string | null,
  cycleEnd: string | null,
  selectedDate: string,
  dynamicPeriod: number | null
): { start: string; end: string } {
  const selected = new Date(selectedDate + 'T00:00:00');

  let start: Date;
  let end: Date;
  if (!cycleStart || !cycleEnd || cycleStart === '0000-00-00' || cycleEnd === '0000-00-00') {
    const y = new Date().getFullYear();
    start = new Date(`${y}-04-01T00:00:00`);
    end = new Date(`${y + 1}-03-31T00:00:00`);
  } else {
    start = new Date(cycleStart + 'T00:00:00');
    end = new Date(cycleEnd + 'T00:00:00');
  }

  const toISO = (d: Date) => d.toISOString().slice(0, 10);
  const addYears = (d: Date, n: number) => new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
  const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
  const lastDayOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

  switch (policyType.toUpperCase()) {
    case 'Y':
    case 'P':
      if (selected < start) {
        start = addYears(start, -1);
        end = addYears(end, -1);
      } else if (selected > end) {
        start = addYears(start, 1);
        end = addYears(end, 1);
      }
      break;
    case 'M': {
      let monthStart = new Date(selected.getFullYear(), selected.getMonth(), 1);
      let monthEnd = lastDayOfMonth(monthStart);
      if (selected < monthStart) {
        monthStart = addMonths(monthStart, -1);
        monthEnd = lastDayOfMonth(monthStart);
      } else if (selected > monthEnd) {
        monthStart = addMonths(monthStart, 1);
        monthEnd = lastDayOfMonth(monthStart);
      }
      start = monthStart;
      end = monthEnd;
      break;
    }
    case 'Q': {
      const quarterStartMonth = Math.floor(selected.getMonth() / 3) * 3;
      start = new Date(selected.getFullYear(), quarterStartMonth, 1);
      end = new Date(selected.getFullYear(), quarterStartMonth + 3, 0);
      break;
    }
    case 'H': {
      const startMonth = selected.getMonth() < 6 ? 0 : 6;
      start = new Date(selected.getFullYear(), startMonth, 1);
      end = new Date(selected.getFullYear(), startMonth + 6, 0);
      break;
    }
    case 'D': {
      end = new Date(selected);
      start = new Date(selected);
      start.setDate(start.getDate() - (dynamicPeriod ?? 0));
      break;
    }
    default:
      break;
  }

  return { start: toISO(start), end: toISO(end) };
}

export interface LeaveBalanceReportRow extends RowDataPacket {
  emp_pkey: number;
  emp_name: string;
  employee_id: string;
  joining_date: string;
  branch: string;
  designation: string;
  department: string;
  leave_type: string;
  leave_policy_type: string;
  alloted_leave_forthe_year: number;
  carry_forward_limit: number | null;
  carryforwarded: number;
  leavebalance: number;
  leavetaken: number;
  yearlybalance: number;
  encashed_leave: number;
}

// Mirrors both the EmployeeDetails branch (single employee, all their active leave policies) and
// the implicit `else` (Units/branch) branch (every active employee in the branch, same per-policy
// loop) — confirmed via source read to share the identical per-employee/per-leave-type query shape
// and getLeaveCycle()-driven cycle math, differing only in how the employee list is gathered.
export async function generateLeaveBalanceReport(pool: Pool, params: LeaveBalanceReportParams) {
  requireCriteria(params.criteria);
  const { conditions, args } = buildCriteriaConditions(params.criteria, {
    Units: 'ed.branch_code', EmployeeDetails: 'ed.emp_pkey',
  });

  const [employees] = await pool.execute<EmployeeRow[]>(
    `SELECT ed.emp_pkey, ep.LEAVEPOLICY_GROUP_ID
     FROM emp_details ed
     JOIN emp_proff ep ON ep.emp_fkey = ed.emp_pkey
     WHERE ed.status = 1 AND ${conditions.join(' AND ')}`,
    args
  );

  const rows: LeaveBalanceReportRow[] = [];

  for (const emp of employees) {
    const [policies] = await pool.execute<LeavePolicyRow[]>(
      `SELECT salary_head_item_fkey, leave_cycle_start_date, leave_cycle_end_date, leave_policy_type, dynamic_period
       FROM leavepolicy WHERE LEAVEPOLICY_GROUP_ID = ? AND status = 1`,
      [emp.LEAVEPOLICY_GROUP_ID]
    );

    for (const policy of policies) {
      const cycle = getLeaveCycle(
        policy.leave_policy_type,
        policy.leave_cycle_start_date,
        policy.leave_cycle_end_date,
        params.asOfDate,
        policy.dynamic_period
      );

      const [[yearlyRow]] = await pool.execute<RowDataPacket[]>(
        `SELECT leave_balance_inthe_year_fn(?, ?, ?) AS yearlybalance`,
        [emp.emp_pkey, policy.salary_head_item_fkey, cycle.end]
      );
      const yearlybalance = Number(yearlyRow?.yearlybalance ?? 0);

      const [[detail]] = await pool.execute<RowDataPacket[]>(
        `SELECT ed.emp_pkey, CONCAT(ed.first_name, ' ', IFNULL(ed.last_name, '')) AS emp_name,
                i.employee_id, i.joining_date, i.branch, i.designation, i.department,
                lp.minimum_service, lp.CARRY_FORWARD_LIMIT AS carry_forward_limit,
                lp.leave_policy_type, lp.alloted_leave_forthe_year,
                LeaveType.item AS leave_type,
                IFNULL(ecf.carry_forwarded, 0) AS carryforwarded,
                leave_balance_inthe_year_fn(ed.emp_pkey, lp.salary_head_item_fkey, ?) AS leavebalance,
                leave_taken_fn(ed.emp_pkey, lp.salary_head_item_fkey, ?) AS leavetaken,
                (SELECT SUM(encash.approved_days) FROM leave_encashment_master encash
                 WHERE encash.salary_head_item_fkey = lp.salary_head_item_fkey AND encash.is_approved = 'Y'
                   AND encash.status = 1 AND encash.emp_fkey = ed.emp_pkey
                   AND encash.approved_date BETWEEN ? AND ?) AS encashed_leave
         FROM emp_details ed
         JOIN emp_proff ep ON ed.emp_pkey = ep.emp_fkey
         JOIN leavepolicy lp ON lp.LEAVEPOLICY_GROUP_ID = ep.LEAVEPOLICY_GROUP_ID AND lp.status = 1
         LEFT JOIN emp_leave_balance_year ecf ON ecf.salary_head_item_fkey = lp.salary_head_item_fkey
           AND ecf.emp_fkey = ed.emp_pkey AND ecf.status = 1
           AND ecf.leave_cycle_start_date >= ? AND ecf.leave_cycle_end_date <= ?
         JOIN salary_head_items LeaveType ON LeaveType.salary_head_item_pkey = lp.salary_head_item_fkey
         JOIN employee_info i ON i.emp_pkey = ed.emp_pkey
         WHERE ed.emp_pkey = ? AND lp.salary_head_item_fkey = ? AND ed.status = 1
         LIMIT 1`,
        [params.asOfDate, params.asOfDate, cycle.start, cycle.end, cycle.start, cycle.end, emp.emp_pkey, policy.salary_head_item_fkey]
      );
      if (!detail) continue;

      // Minimum-service eligibility zero-out (legacy: eligibility_date > $from -> leavebalance = 0).
      let leavebalance = Number(detail.leavebalance ?? 0);
      if (detail.minimum_service && detail.joining_date) {
        const eligibility = new Date(detail.joining_date);
        eligibility.setMonth(eligibility.getMonth() + Number(detail.minimum_service));
        if (eligibility > new Date(params.asOfDate + 'T00:00:00')) leavebalance = 0;
      }

      const carryLimit = detail.carry_forward_limit != null ? Number(detail.carry_forward_limit) : null;
      const carryforwarded = Number(detail.carryforwarded ?? 0);

      rows.push({
        ...detail,
        alloted_leave_forthe_year: detail.leave_policy_type === 'P' ? 0 : Number(detail.alloted_leave_forthe_year ?? 0),
        carry_forward_limit: carryLimit,
        carryforwarded: carryLimit != null ? Math.min(carryforwarded, carryLimit) : carryforwarded,
        leavebalance: Math.round(leavebalance * 10) / 10,
        leavetaken: Number(detail.leavetaken ?? 0),
        yearlybalance: Math.round(yearlybalance * 10) / 10,
        encashed_leave: Number(detail.encashed_leave ?? 0),
      } as LeaveBalanceReportRow);
    }
  }

  return rows;
}
