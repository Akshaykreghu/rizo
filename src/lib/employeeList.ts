import type { Pool, RowDataPacket } from 'mysql2/promise';

// The admin "All Employees" list — ports legacy EmployeeJoinController::index()'s summary cards,
// listemployees()'s Filter-menu conditions, and calculateOnboardingPercentage().

// Legacy's Filter menu (View/EmployeeJoin/index.ctp #filterPanel). 'active' is the default.
export const EMPLOYEE_LIST_FILTERS = ['active', 'resigned', 'notice', 'this_month', 'previous_month'] as const;
export type EmployeeListFilter = (typeof EMPLOYEE_LIST_FILTERS)[number];

export function isEmployeeListFilter(v: string): v is EmployeeListFilter {
  return (EMPLOYEE_LIST_FILTERS as readonly string[]).includes(v);
}

// WHERE fragments over `e` (emp_details) and `p` (emp_proff), matching listemployees():
//   resigned        status = 2
//   active          status = 1
//   notice          still active, with an approved resignation (termination.status = 1) whose last
//                   working day hasn't passed yet
//   this_month      active, joined in the current calendar month
//   previous_month  active, joined in the previous calendar month
export function employeeListFilterSql(filter: EmployeeListFilter): string {
  switch (filter) {
    case 'resigned':
      return 'e.status = 2';
    case 'notice':
      return `e.status = 1 AND EXISTS (
        SELECT 1 FROM termination t
        WHERE t.emp_fkey = e.emp_pkey AND t.status = 1 AND CURDATE() <= t.last_approved_working_date)`;
    case 'this_month':
      return `e.status = 1 AND p.joining_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') AND p.joining_date <= LAST_DAY(CURDATE())`;
    case 'previous_month':
      return `e.status = 1
        AND p.joining_date >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01')
        AND p.joining_date <= LAST_DAY(CURDATE() - INTERVAL 1 MONTH)`;
    default:
      return 'e.status = 1';
  }
}

// Summary cards, exactly as legacy index() counts them.
export async function employeeSummary(pool: Pool) {
  const [[row]] = await pool.execute<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM emp_details WHERE status != 0 AND status != 4) AS total,
       (SELECT COUNT(*) FROM emp_details WHERE status = 1) AS active,
       (SELECT COUNT(DISTINCT ep.emp_fkey) FROM emp_proff ep
          JOIN emp_details ed ON ed.emp_pkey = ep.emp_fkey
         WHERE ep.structure_id IS NULL AND ed.status = 1) AS no_salary_structure,
       (SELECT COUNT(*) FROM emp_proff ep
          JOIN emp_details ed ON ed.emp_pkey = ep.emp_fkey
         WHERE YEAR(ep.joining_date) = YEAR(CURDATE()) AND MONTH(ep.joining_date) = MONTH(CURDATE())) AS joined_this_month`
  );
  return {
    total: Number(row.total),
    active: Number(row.active),
    noSalaryStructure: Number(row.no_salary_structure),
    joinedThisMonth: Number(row.joined_this_month),
  };
}

// Rows behind the two downloadable cards (legacy downloadMissingSalary() / thisMonthJoining()).
export async function employeeSummaryList(pool: Pool, list: 'no_salary_structure' | 'joined_this_month') {
  const where = list === 'no_salary_structure'
    ? 'ep.structure_id IS NULL AND ed.status = 1'
    : 'YEAR(ep.joining_date) = YEAR(CURDATE()) AND MONTH(ep.joining_date) = MONTH(CURDATE())';
  const order = list === 'no_salary_structure' ? 'name' : 'ep.joining_date';
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT IFNULL(NULLIF(TRIM(ep.emp_company_id), ''), ed.emp_id) AS emp_code,
            CONCAT_WS(' ', ed.first_name, ed.last_name) AS name,
            DATE_FORMAT(ep.joining_date, '%d-%m-%Y') AS joining_date,
            b.branch_name, ds.desig_name
     FROM emp_proff ep
     JOIN emp_details ed ON ed.emp_pkey = ep.emp_fkey
     LEFT JOIN branches b ON b.branch_code = ep.emp_branch
     LEFT JOIN designation ds ON ds.desig_code = ep.designation
     WHERE ${where}
     ORDER BY ${order} ASC`
  );
  return rows;
}

const PERSONAL_FIELDS = [
  'first_name', 'date_of_birth', 'classification', 'email', 'mobile_no', 'address', 'pincode',
  'nationality_id', 'city', 'state', 'maritual_status', 'guradian', 'relation_guardian', 'blood',
  'id_card', 'pan_no', 'bank_name', 'branch_name', 'ifsc_code', 'account_no', 'esi_dispensary', 'esi',
  'pf', 'company_pf', 'previous_member_id', 'wps_code', 'lwf_code', 'profile_pic', 'international_worker',
  'country',
] as const;

// legacy $isFilled: set, non-blank, and not the literal "0" placeholder.
function filled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  const s = v instanceof Date ? v.toISOString() : String(v).trim();
  return s !== '' && s !== '0';
}

const pct = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 100);

// Profile completion % per employee — legacy calculateOnboardingPercentage(): the plain average of
// 7 sections (Personal, Company, Education, Family, Work, Documents, Config), batched for a page of
// employees instead of legacy's per-row queries.
//
// One deliberate difference: legacy's Config section counts SHIFT/HOLIDAY/LEAVE/HIERARCHY rows in
// emp_config only. This app stores those four on emp_proff (day_time_seq, HOLIDAY_GROUP_ID,
// LEAVEPOLICY_GROUP_ID, attr1) when onboarding or editing an employee, so each one counts when it
// is set in either place — otherwise every employee created here would score 0 for Config.
export async function profileCompletion(pool: Pool, ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!ids.length) return out;
  const inList = ids.map(() => '?').join(',');

  const [[personal], [company], [counts], [config]] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT emp_pkey, ${PERSONAL_FIELDS.join(', ')} FROM emp_details WHERE emp_pkey IN (${inList})`,
      ids
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT p.emp_fkey, p.joining_date, p.emp_branch, p.emp_dept, p.designation, p.emp_type, p.notice_days,
              p.emp_grade, p.probation, cd.contract_start_date, cd.contract_end_date
       FROM emp_proff p
       LEFT JOIN contracted_days cd ON cd.emp_fkey = p.emp_fkey AND cd.status = 1
       WHERE p.emp_fkey IN (${inList})`,
      ids
    ),
    // Legacy falls back to the emp_join-era tables (family/Education/work_experience/emp_documents)
    // keyed by the same number when the employee tables have nothing.
    pool.execute<RowDataPacket[]>(
      `SELECT e.emp_pkey AS id,
         (SELECT COUNT(*) FROM emp_family WHERE emp_fkey = e.emp_pkey AND status = 1)
           + (SELECT COUNT(*) FROM family WHERE emp_join_fkey = e.emp_pkey AND status = 1) AS fam,
         (SELECT COUNT(*) FROM qualifcations WHERE emp_fkey = e.emp_pkey AND status = 1) AS edu,
         (SELECT COUNT(*) FROM history WHERE emp_fkey = e.emp_pkey AND status = 1)
           + (SELECT COUNT(*) FROM work_experience WHERE emp_join_fkey = e.emp_pkey AND status = 1) AS work,
         (SELECT COUNT(*) FROM emp_passport_visa WHERE emp_fkey = e.emp_pkey AND status = 1)
           + (SELECT COUNT(*) FROM emp_documents WHERE emp_join_fkey = e.emp_pkey AND status = 1) AS docs
       FROM emp_details e WHERE e.emp_pkey IN (${inList})`,
      ids
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT p.emp_fkey AS id,
         (p.day_time_seq IS NOT NULL AND p.day_time_seq != 0
           OR EXISTS (SELECT 1 FROM emp_config c WHERE c.emp_fkey = p.emp_fkey AND c.status = 1 AND c.type = 'SHIFT')) AS shift_set,
         (p.HOLIDAY_GROUP_ID IS NOT NULL AND p.HOLIDAY_GROUP_ID != 0
           OR EXISTS (SELECT 1 FROM emp_config c WHERE c.emp_fkey = p.emp_fkey AND c.status = 1 AND c.type = 'HOLIDAY')) AS holiday_set,
         (p.LEAVEPOLICY_GROUP_ID IS NOT NULL AND p.LEAVEPOLICY_GROUP_ID != 0
           OR EXISTS (SELECT 1 FROM emp_config c WHERE c.emp_fkey = p.emp_fkey AND c.status = 1 AND c.type = 'LEAVE')) AS leave_set,
         (IFNULL(TRIM(p.attr1), '') NOT IN ('', '0')
           OR EXISTS (SELECT 1 FROM emp_config c WHERE c.emp_fkey = p.emp_fkey AND c.status = 1 AND c.type = 'HIERARCHY')) AS hierarchy_set
       FROM emp_proff p WHERE p.emp_fkey IN (${inList})`,
      ids
    ),
  ]);

  const personalBy = new Map(personal.map((r) => [Number(r.emp_pkey), r]));
  const companyBy = new Map(company.map((r) => [Number(r.emp_fkey), r]));
  const countsBy = new Map(counts.map((r) => [Number(r.id), r]));
  const configBy = new Map(config.map((r) => [Number(r.id), r]));

  for (const id of ids) {
    // 1. Personal
    const e = personalBy.get(id);
    let pTotal = PERSONAL_FIELDS.length;
    let pFilled = 0;
    if (e) {
      const international = String(e.international_worker ?? '').trim().toLowerCase() === 'y';
      for (const f of PERSONAL_FIELDS) {
        if (f === 'country' && !international) { pTotal--; continue; }
        const v = e[f];
        if (f === 'profile_pic') {
          if (filled(v) && !/placeholder(men|women)\.jpeg/.test(String(v))) pFilled++;
        } else if (filled(v)) {
          pFilled++;
        }
      }
    }
    const personalPct = e ? pct(pFilled, pTotal) : 0;

    // 2. Company — 6 base fields plus type-specific ones.
    const c = companyBy.get(id);
    let companyPct = 0;
    if (c) {
      let cFilled = ['joining_date', 'emp_branch', 'emp_dept', 'designation', 'emp_type', 'notice_days'].filter((f) => filled(c[f])).length;
      let cTotal = 6;
      const empType = String(c.emp_type ?? '').trim().toLowerCase();
      if (empType === 'permanent') { cTotal++; if (filled(c.emp_grade)) cFilled++; }
      else if (empType === 'contract') {
        cTotal += 2;
        if (filled(c.contract_start_date)) cFilled++;
        if (filled(c.contract_end_date)) cFilled++;
      } else if (empType === 'probation') { cTotal++; if (filled(c.probation)) cFilled++; }
      companyPct = pct(cFilled, cTotal);
    }

    // 3–6. Present-or-not sections.
    const n = countsBy.get(id);
    const has = (k: string) => (n && Number(n[k]) > 0 ? 100 : 0);

    // 7. Config — 4 policies.
    const cfg = configBy.get(id);
    const cfgCount = cfg ? ['shift_set', 'holiday_set', 'leave_set', 'hierarchy_set'].filter((k) => Number(cfg[k]) === 1).length : 0;
    const configPct = Math.round((cfgCount / 4) * 100);

    out.set(id, Math.round((personalPct + companyPct + has('edu') + has('fam') + has('work') + has('docs') + configPct) / 7));
  }
  return out;
}
