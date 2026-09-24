import type { Pool, RowDataPacket } from 'mysql2/promise';
import { requireCriteria, buildCriteriaConditions, type CriteriaSelections } from './reports';

// Ports MiscellaniousReportsController::generatecompoffreport_new() (confirmed live routed
// function for GRTL, same dispatcher pattern as Monthly Leave — company_code isn't DEMO/SRTS or in
// the Compoff restricted-companies list) — "Comp Off Details Report" under Miscellaneous Reports.
// Two row kinds unioned per employee: "Accrued" (a weekoff/holiday actually worked, eligible for
// comp-off, from emp_detail_timeattandance) and "Utilized" (a comp-off leave day actually taken,
// from emp_leave_transactions against the salary head tagged occurance='COFF'). Per source read,
// legacy's own function only implements the EmployeeDetails criteria branch with real employee/
// accrued/utilized detail — its `else` branch is a degraded flat leaveentries-only fallback with no
// employee/accrued join at all, so (matching the same precedent as Monthly Leave) this port only
// supports EmployeeDetails.

export interface CompOffReportParams {
  fromDate: string;
  toDate: string;
  criteria: CriteriaSelections;
}

export interface CompOffReportRow extends RowDataPacket {
  emp_pkey: number;
  emp_name: string;
  employee_id: string;
  joining_date: string;
  branch: string;
  department: string;
  designation: string;
  status: number;
  leave_policy_type: string | null;
  transaction_type: 'Accrued' | 'Utilized';
  transaction_date: string;
  day: string | null;
  duration: string | null;
  day_type: string | null;
  txn_status: string | null;
}

async function resolveCompOffHeadId(pool: Pool): Promise<number | null> {
  const [byOccurance] = await pool.execute<RowDataPacket[]>(
    `SELECT salary_head_item_pkey FROM salary_head_items WHERE occurance = 'COFF' LIMIT 1`
  );
  if (byOccurance.length) return byOccurance[0].salary_head_item_pkey as number;
  const [byName] = await pool.execute<RowDataPacket[]>(
    `SELECT salary_head_item_pkey FROM salary_head_items WHERE item LIKE '%Comp%Off%' AND status = 1 LIMIT 1`
  );
  return byName.length ? (byName[0].salary_head_item_pkey as number) : null;
}

export async function generateCompOffReport(pool: Pool, params: CompOffReportParams) {
  requireCriteria(params.criteria);
  const { conditions, args } = buildCriteriaConditions(params.criteria, { EmployeeDetails: 'ed.emp_pkey' });

  const compOffHeadId = await resolveCompOffHeadId(pool);
  if (!compOffHeadId) return [];

  const [empRows] = await pool.execute<RowDataPacket[]>(
    `SELECT ed.emp_pkey, CONCAT(ed.first_name, ' ', ed.last_name) AS emp_name, ed.status,
            i.employee_id, i.joining_date, i.branch, i.department, i.designation,
            (SELECT lp.leave_policy_type FROM leavepolicy lp
             JOIN emp_proff ep2 ON ep2.LEAVEPOLICY_GROUP_ID = lp.LEAVEPOLICY_GROUP_ID
             WHERE ep2.emp_fkey = ed.emp_pkey AND lp.salary_head_item_fkey = ? AND lp.status = 1
             LIMIT 1) AS leave_policy_type
     FROM emp_details ed
     JOIN employee_info i ON i.emp_pkey = ed.emp_pkey
     WHERE ${conditions.join(' AND ')}`,
    [compOffHeadId, ...args]
  );
  if (!empRows.length) return [];

  const rows: CompOffReportRow[] = [];

  for (const emp of empRows) {
    // Accrued: a weekoff/holiday day actually worked (duration logged), eligible for comp-off
    // (work_time_day_off_cal_ot = '2' or '4', matching legacy's two unioned queries exactly).
    const [accrued] = await pool.execute<RowDataPacket[]>(
      `SELECT att_date, duration, weekoff, holiday FROM emp_detail_timeattandance
       WHERE att_date BETWEEN ? AND ? AND emp_pkey = ? AND (weekoff != '' OR holiday != '') AND duration != ''
         AND emp_pkey IN (
           SELECT emp_fkey FROM emp_proff WHERE day_time_seq IN (
             SELECT day_time_seq FROM working_day_time_procedures WHERE work_time_day_off_cal_ot = '2'
           )
         )
       UNION
       SELECT att_date, duration, weekoff, holiday FROM emp_detail_timeattandance
       WHERE att_date BETWEEN ? AND ? AND emp_pkey = ? AND holiday != '' AND duration != ''
         AND emp_pkey IN (
           SELECT emp_fkey FROM emp_proff WHERE day_time_seq IN (
             SELECT day_time_seq FROM working_day_time_procedures WHERE work_time_day_off_cal_ot = '4'
           )
         )`,
      [params.fromDate, params.toDate, emp.emp_pkey, params.fromDate, params.toDate, emp.emp_pkey]
    );
    for (const a of accrued) {
      rows.push({
        ...emp,
        transaction_type: 'Accrued',
        transaction_date: a.att_date,
        day: null,
        duration: String(a.duration ?? ''),
        day_type: `${a.weekoff ?? ''} ${a.holiday ?? ''}`.trim(),
        txn_status: 'Accrued',
      } as CompOffReportRow);
    }

    // Utilized: comp-off leave days actually taken against this employee's comp-off leave request(s)
    // in the selected date range.
    const [utilized] = await pool.execute<RowDataPacket[]>(
      `SELECT elt.leave_date, elt.leave_session, elt.Leavestatus
       FROM emp_leave_transactions elt
       JOIN leaveentries le ON le.LEAVEENTRYID = elt.LEAVEENTRYID
       WHERE le.salary_head_item_fkey = ? AND le.EMP_fkey = ? AND le.TODATE BETWEEN ? AND ?`,
      [compOffHeadId, emp.emp_pkey, params.fromDate, params.toDate]
    );
    for (const u of utilized) {
      const day =
        u.leave_session === 1 ? '0.5 (First Half)' : u.leave_session === 2 ? '0.5 (Second Half)' : '1 (Full Day)';
      rows.push({
        ...emp,
        transaction_type: 'Utilized',
        transaction_date: u.leave_date,
        day,
        duration: null,
        day_type: null,
        txn_status: u.Leavestatus,
      } as CompOffReportRow);
    }
  }

  return rows;
}
