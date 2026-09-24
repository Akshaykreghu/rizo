import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompanyPool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import ExcelJS from 'exceljs';

// Ports legacy EmpreportNewController — the employee-login reports linked from the employee
// dashboard (Dashboard/empdashboard), i.e. the newer copy of EmpreportController:
//   salary          → salarystructure()        "CTC Detail"
//   shift           → shiftpolicyreport()      "My Shift Timings"
//   leave-policy    → leavepolicyreport()      "Leave Details" (policy tabs + leave calendar; also its
//                                               'json' mode, used by the Attendance page's Leave Balance)
//   leave-entry     → showleavedetails()       (leave calendar click panel)
//   leave-details   → leavedetailsreport()     "Leave Details Report"
//   holidays        → Grade::Getholidays()     "Holiday Calendar"
//   attendance      → getattendancedays()      "Attendance Report" calendar
//   attendance-day  → showattendancedetails()  (a clicked day, or the whole month's punch log)
// Every report is the session employee's own data only, exactly as legacy (Session emp_fkey).

type Rows = RowDataPacket[];

// leavepolicyreport(): companies whose balance is "as per current date" with leaves taken counted
// inside the policy's leave cycle; every other company gets the financial-year balance plus the
// month's balance, with leaves taken counted over the calendar year.
const LEAVE_CURRENT_DATE_COMPANIES = [
  'HDFN', 'HDEQ', 'DYGL', 'HDSC', 'EXTR', 'RRLC', 'MRZC', 'ETNA', 'ETLE', 'CGMM', 'DDP', 'IFHY', 'MNDM', 'AMY', 'CSMT', 'NWTR',
  'GLET', 'EDGM', 'SMGR', 'HLLM', 'STPN', 'ANAH', 'ACCS', 'TRCK', 'NRTH', 'VRBS', 'NOMD', 'CIES', 'FRSG', 'BLBR', 'TSSM', 'ELKT',
  'DHLS', 'LNTT', 'ELTS', 'PNDN', 'MNDL', 'PSSN', 'IMSC', 'FYNK', 'WHOO', 'SVNS', 'EMVI', 'ASQR', 'BNGL', 'CKWR', 'NNCZ', 'SRTS',
  'SCRS', 'MMSR', 'MLYR', 'INDR', 'MCYB', 'MLYP', 'MLYT', 'MATT', 'MLYG', 'ALPS', 'ASHL', 'ASTL', 'DVDS', 'FSHN', 'THMR', 'GLDN',
  'ELGF', 'TRCM', 'MADA', 'BTTR', 'HHMG', 'GLBL', 'GUAO', 'NLRT', 'GYDB', 'THNG', 'PCVL', 'TICM', 'AELY', 'NRMY', 'GRNH', 'ATNE',
  'AYRG', 'DRRC', 'DJIC', 'DJOC', 'CMPT', 'VNDG', 'LKNC', 'AMST', 'NTCM', 'ELSL', 'TRSN', 'ELLI', 'LBLD', 'DDCS', 'DRMS', 'VSNT',
  'MPCP', 'GRNS', 'BPHR', 'MDGN', 'THDP', 'ANND', 'HLPH', 'HLNT', 'SHIN', 'TRSR', 'STFR', 'SHYD', 'LNWY', 'DEMO',
];
// leavedaysreport view: these show the single "Balance (As Per Current Date)"; everyone else sees
// "Balance For The Year" + "Balance For The Month".
const LEAVE_SINGLE_BALANCE_VIEW = ['HDFN', 'HDEQ', 'DEMO', 'GLET', 'DYGL', 'HDSC', 'EXTR', 'RRLC', 'MRZC', 'ETNA', 'ETLE', 'CGMM', 'DDP', 'IFHY', 'MNDM'];
const ATTENDANCE_RESTRICTED = ['ABSG', 'VGFS', 'VSFS', 'DRRC', 'DJIC', 'AGNG', 'AYRK', 'SHRD', 'SNRY', 'GTRA', 'VGNN', 'SHYD'];

const EMP_NAME = (col: string) =>
  `(SELECT CONCAT_WS(' ', first_name, NULLIF(middile_name, ''), last_name) FROM emp_details WHERE emp_pkey = ${col})`;

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthEnd(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function addMonths(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

// PHP date("H:i:s", strtotime($v)) — '00:00:00' when there's no time.
function hms(v: unknown) {
  const s = v == null ? '' : String(v);
  const m = s.match(/(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : '00:00:00';
}

async function employeeHeader(pool: Pool, empFkey: number) {
  const [[emp]] = await pool.execute<Rows>(
    `SELECT e.emp_pkey, CONCAT_WS(' ', e.first_name, e.last_name) AS name,
            COALESCE(NULLIF(TRIM(p.emp_company_id), ''), e.emp_id) AS emp_code,
            ds.desig_name, dp.dept_name, b.branch_name, DATE_FORMAT(p.joining_date, '%Y-%m-%d') AS joining_date
     FROM emp_details e
     LEFT JOIN emp_proff p ON p.emp_fkey = e.emp_pkey
     LEFT JOIN designation ds ON ds.desig_code = p.designation
     LEFT JOIN department dp ON dp.dept_code = p.emp_dept
     LEFT JOIN branches b ON b.branch_code = p.emp_branch
     WHERE e.emp_pkey = ?`,
    [empFkey]
  );
  return emp ?? null;
}

// salarystructure(): current Addition heads (head groups 1/4/10, one row per head description)
// + variable-pay uploads, in the heads' display order with Indirect heads last. Rows with
// item_part 'Indirect' are listed after Gross and added into Cost to the Company.
async function salary(pool: Pool, empFkey: number) {
  const [rows] = await pool.execute<Rows>(
    `SELECT * FROM (
       SELECT ectc.salary_head_item_desc, MAX(ectc.structure_det_value) AS structure_det_value,
              MAX(ectc.item_part) AS item_part, MAX(shead.salary_head_item_order1) AS item_order
       FROM emp_salary_structure ectc
       JOIN emp_details ed ON ed.emp_pkey = ectc.emp_fkey
       LEFT JOIN salary_head_items shead ON shead.salary_head_item_pkey = ectc.salary_head_item_fkey
       WHERE ectc.head_operator = 'ADDITION' AND ectc.emp_fkey = ? AND ed.status = 1 AND ectc.end_date_effective IS NULL
         AND ectc.salary_head_item_fkey IN (SELECT salary_head_item_pkey FROM salary_head_items WHERE head_fkey IN (1, 4, 10))
       GROUP BY ectc.salary_head_item_desc
       UNION
       SELECT ectc.salary_head_item_desc, ectc.structure_det_value, ectc.item_part, shead.salary_head_item_order1
       FROM emp_variable_pay_upload ectc
       JOIN emp_details ed ON ed.emp_pkey = ectc.emp_fkey
       LEFT JOIN salary_head_items shead ON shead.salary_head_item_pkey = ectc.salary_head_item_fkey
       WHERE ectc.emp_fkey = ? AND ed.status = 1
     ) t
     ORDER BY item_order, CASE WHEN item_part = 'Indirect' THEN 1 ELSE 0 END`,
    [empFkey, empFkey]
  );
  const items = rows.map((r) => ({ name: String(r.salary_head_item_desc ?? '').trim(), amount: Number(r.structure_det_value) || 0, indirect: r.item_part === 'Indirect' }));
  const gross = items.filter((i) => !i.indirect).reduce((s, i) => s + i.amount, 0);
  const ctc = gross + items.filter((i) => i.indirect).reduce((s, i) => s + i.amount, 0);
  return { employee: await employeeHeader(pool, empFkey), direct: items.filter((i) => !i.indirect), indirect: items.filter((i) => i.indirect), gross, ctc };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const EXCEPTION_WEEK: Record<string, string> = { '1': '1st Week', '2': '2nd Week', '3': '3rd Week', '4': '4th Week', '5': '5th Week', L: '2nd & 4th Week', A: 'Every Week' };

// PHP date('h:i A', strtotime('09:30:00')) → '09:30 AM'.
function hmAmPm(v: unknown) {
  const m = String(v ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = Number(m[1]);
  return `${String(h % 12 || 12).padStart(2, '0')}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}
const minOrDash = (v: unknown) => (v && Number(v) !== 0 ? `${v} min` : '—');

// shiftpolicyreport(): the employee's shift (emp_proff.day_time_seq) and, when the shift has
// exceptions switched on, its active shift_exceptions rows.
async function shift(pool: Pool, empFkey: number) {
  const [[s]] = await pool.execute<Rows>(
    `SELECT * FROM working_day_time_procedures WHERE day_time_seq IN (SELECT day_time_seq FROM emp_proff WHERE emp_fkey = ?)`,
    [empFkey]
  );
  if (!s) return { employee: await employeeHeader(pool, empFkey), shift: null };

  const itemName = async (pkey: unknown) => {
    const id = Number(pkey) || 0;
    if (!id) return null;
    const [[r]] = await pool.execute<Rows>('SELECT item FROM salary_head_items WHERE salary_head_item_pkey = ?', [id]);
    return (r?.item as string) || null;
  };

  let exceptions: { day: string; inTime: string; outTime: string; duration: string; week: string }[] = [];
  if (Number(s.is_exception) === 1) {
    const [ex] = await pool.execute<Rows>(
      'SELECT ex_week_day, ex_week, week_off, in_time, out_time, duration FROM shift_exceptions WHERE shift_id = ? AND status = 1',
      [s.day_time_seq]
    );
    exceptions = ex.map((e) => {
      const off = e.week_off === 'Y';
      return {
        day: String(e.ex_week_day ?? ''),
        inTime: !off && e.in_time ? hmAmPm(e.in_time) : '—',
        outTime: !off && e.out_time ? hmAmPm(e.out_time) : '—',
        duration: !off && e.duration != null ? `${e.duration} min` : '—',
        week: EXCEPTION_WEEK[String(e.ex_week)] ?? String(e.ex_week ?? ''),
      };
    });
  }

  const multi = s.is_multiple_days === 'Y';
  const offDay = ({ '1': 'Over Time', '2': 'Comp Off', '3': 'Other' } as Record<string, string>)[String(s.work_time_day_off_cal_ot ?? '0')];
  // off_dutty2 when it's a real time (> 0), otherwise off_dutty1.
  const off2 = String(s.off_dutty2 ?? '');
  const endTime = /[1-9]/.test(off2) ? off2 : String(s.off_dutty1 ?? '');

  return {
    employee: await employeeHeader(pool, empFkey),
    shift: {
      title: String(s.day_time_desc ?? '').toUpperCase() || '—',
      // A day's _F = 'Y' (half week-off) wins over its working flag.
      days: DAYS.map((d) => ({ day: d.slice(0, 3), status: s[`${d}_F`] === 'Y' ? 'Half' : s[d] === 'Y' ? 'Full' : 'Off' })),
      start: String(s.on_dutty1 ?? '') || '—',
      end: endTime || '—',
      minsPerDay: s.minuts_calc_perday ? Number(s.minuts_calc_perday) : null,
      rules: [
        { label: 'Full Day', value: minOrDash(s.minuts_calc_perday) },
        { label: 'Half Day', value: minOrDash(s.minutes_per_half) },
        { label: 'Late In-Limit', value: minOrDash(s.minuts_aftr_on_dutty_cal_late) },
        { label: 'Early Out-Limit', value: minOrDash(s.minuts_bfr_off_dutty_cal_early) },
        { label: 'Monitoring Type', value: s.strict_monitorings === 'Y' ? 'Strict' : 'Flexible' },
        { label: 'Multi Shift', value: multi ? `Enabled (${s.no_of_shift_days ?? ''} days)` : 'Disabled' },
        { label: 'OT Min. Time After Shift', value: minOrDash(s.min_aftr_off_dutty_cal_ot) },
        { label: 'OT Min. Time Before Shift', value: minOrDash(s.min_bfr_on_dutty_cal_ot) },
        { label: multi ? 'Balance (Monthly Working)' : 'Working On Off-Day', value: offDay ?? 'Disabled' },
        { label: 'Shift Allowance', value: (await itemName(s.shift_allowance)) ?? 'Disabled' },
        { label: 'Salary Component for OT', value: (await itemName(s.otcomponents)) ?? 'Disabled' },
      ],
      exceptions,
    },
  };
}

const POLICY_TYPE: Record<string, [string, string]> = {
  Y: ['Yearly', 'Yearly Limit'], M: ['Monthly', 'Monthly Limit'], P: ['Present Days', 'Present Days Based Limit'],
  Q: ['Quarterly', 'Quarterly Limit'], D: ['Running Days', 'Running Days Based Limit'], H: ['Half-Yearly', 'Half-Yearly Limit'],
};

// leavepolicyreport() (rendered with the leavedaysreport view) + Getleavedays() calendar events.
async function leavePolicy(pool: Pool, empFkey: number, companyCode: string) {
  const company = companyCode.toUpperCase();
  const currentDateBalance = LEAVE_CURRENT_DATE_COMPANIES.includes(company);
  const [[fy]] = await pool.execute<Rows>(
    `SELECT fin_year FROM fin_year
     WHERE is_current_finyear = 'Y' AND status = 1 AND Year_status = 'OPEN' AND vattr1 = 0
       AND branch_code IN (SELECT branch_code FROM emp_details WHERE emp_pkey = ?)
     LIMIT 1`,
    [empFkey]
  );
  const year = String(fy?.fin_year ?? new Date().getFullYear());

  const balanceCols = currentDateBalance
    ? `leave_balance_inthe_year_fn(?, salary_head_item_fkey, ?) AS leavebal, NULL AS monthlybalance`
    : `leave_balance_inthe_year_fn(?, salary_head_item_fkey, ?) AS leavebal, leave_balance_inthe_month_fn(?, salary_head_item_fkey, ?, ?) AS monthlybalance`;
  // Legacy passes the bare fin year ('2026') and 'Y M' ('2026 Sep') into these functions' DATE
  // parameters, which only survives a lax sql_mode. As in lib/settlement.ts and lib/leave.ts: the
  // year function gets NULL (its own fallback is CURRENT_DATE, the year legacy means) and the
  // month function gets today's date (the month legacy means).
  const balanceParams = currentDateBalance ? [empFkey, todayIso()] : [empFkey, null, empFkey, todayIso(), year];
  const takenRange = currentDateBalance ? `leavepolicy.leave_cycle_start_date AND leavepolicy.leave_cycle_end_date` : `? AND ?`;
  const takenParams = currentDateBalance ? [] : [`${year}-01-01`, `${year}-12-31`];

  const [policies] = await pool.query<Rows>(
    `SELECT (SELECT (COUNT(CASE WHEN leave_session = 3 THEN 1 END) + COUNT(CASE WHEN leave_session != 3 THEN 1 END) / 2)
             FROM emp_leave_transactions
             WHERE Leavestatus IN ('Approved', 'Applied', 'Authorized')
               AND LEAVEENTRYID IN (SELECT LEAVEENTRYID FROM leaveentries WHERE EMP_fkey = ? AND salary_head_item_fkey = leavepolicy.salary_head_item_fkey)
               AND leave_date BETWEEN ${takenRange}) AS taken,
            is_leave_encash, occurance, REMARKS, item, alloted_leave_forthe_year, alloted_leave_forthe_month, leave_policy_type,
            CARRY_FORWARD_LIMIT, ALLOW_NEGETIVE, IS_SANDWICH, ${balanceCols}
     FROM leavepolicy, salary_head_items
     WHERE salary_head_item_fkey = salary_head_item_pkey
       AND LEAVEPOLICY_GROUP_ID IN (SELECT LEAVEPOLICY_GROUP_ID FROM emp_proff WHERE emp_fkey = ? AND leavepolicy.status = 1)`,
    [empFkey, ...takenParams, ...balanceParams, empFkey]
  );

  const [days] = await pool.execute<Rows>(
    `SELECT le.LEAVEENTRYID, shi.occurance, shi.item, DATE_FORMAT(elt.leave_date, '%Y-%m-%d') AS leave_date, elt.leave_session
     FROM emp_leave_transactions elt
     JOIN leaveentries le ON le.LEAVEENTRYID = elt.LEAVEENTRYID
     JOIN salary_head_items shi ON shi.salary_head_item_pkey = le.salary_head_item_fkey
     WHERE elt.Leavestatus IN ('Applied', 'Authorized', 'Approved', 'Cancelled') AND le.EMP_fkey = ?`,
    [empFkey]
  );

  return {
    employee: await employeeHeader(pool, empFkey),
    singleBalance: LEAVE_SINGLE_BALANCE_VIEW.includes(company),
    policies: policies.map((p) => {
      const [typeLabel, limitLabel] = POLICY_TYPE[p.leave_policy_type as string] ?? ['-', '-'];
      return {
        code: p.occurance as string, name: p.item as string, typeLabel, limitLabel,
        limit: p.alloted_leave_forthe_year, monthlyLimit: p.alloted_leave_forthe_month ?? 0, encash: p.is_leave_encash === 'Y', carryForward: p.CARRY_FORWARD_LIMIT,
        sandwich: p.IS_SANDWICH === 'Y', allowNegative: p.leave_policy_type !== 'P' ? p.ALLOW_NEGETIVE === 'Y' : null,
        remarks: p.REMARKS ?? '', taken: Number(p.taken ?? 0).toFixed(1),
        balance: p.leavebal ?? 0, monthlyBalance: p.monthlybalance ?? 0,
      };
    }),
    // Getleavedays(): one event per leave day; colour by session.
    events: days.map((d) => {
      const session = Number(d.leave_session);
      const [color, label] = session === 3 ? ['#00659f', 'Full Day'] : session === 2 ? ['crimson', 'Second Half'] : ['green', 'First Half'];
      return { id: Number(d.LEAVEENTRYID), date: d.leave_date as string, title: d.occurance as string, tooltip: `${d.item} - ${label}`, color };
    }),
  };
}

const halfLabel = (v: unknown) => (String(v) === '1' ? 'First Half' : 'Second Half');
const cleanDate = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return !s || s.startsWith('0000') || s.startsWith('1970') ? '' : s;
};

// showleavedetails(): one leave entry, Authorized/Approved By default to 'Admin'.
async function leaveEntry(pool: Pool, empFkey: number, id: number) {
  const [[r]] = await pool.execute<Rows>(
    `SELECT item, DATE_FORMAT(applied_date, '%Y-%m-%d') AS applied_date, LEAVESTATUS,
            DATE_FORMAT(FROMDATE, '%Y-%m-%d') AS FROMDATE, FROMHALF, DATE_FORMAT(TODATE, '%Y-%m-%d') AS TODATE, TOHALF,
            IFNULL(${EMP_NAME('ISAutherizedby')}, 'Admin') AS authorized_by, DATE_FORMAT(Autherized_date, '%Y-%m-%d') AS authorized_date,
            IFNULL(${EMP_NAME('APPROVEDBY')}, 'Admin') AS approved_by, DATE_FORMAT(APPROVED_date, '%Y-%m-%d') AS approved_date,
            Reason, contact_person, leave_days
     FROM leaveentries JOIN salary_head_items ON salary_head_item_pkey = salary_head_item_fkey
     WHERE EMP_fkey = ? AND LEAVEENTRYID = ?`,
    [empFkey, id]
  );
  if (!r) return null;
  return {
    leaveType: r.item, fromDate: r.FROMDATE, fromHalf: halfLabel(r.FROMHALF), toDate: r.TODATE, toHalf: halfLabel(r.TOHALF),
    days: r.leave_days, appliedDate: cleanDate(r.applied_date), status: r.LEAVESTATUS, reason: r.Reason ?? '',
    handoverTo: r.contact_person ?? '', authorizedBy: r.authorized_by, authorizedDate: cleanDate(r.authorized_date),
    approvedBy: r.approved_by, approvedDate: cleanDate(r.approved_date),
  };
}

// leavedetailsreport(): every leave entry, newest first, with the authorizer/approver remarks and
// a derived Rejected By / Remark / Date (the approver when the leave reached approval, otherwise
// the authorizer).
async function leaveDetails(pool: Pool, empFkey: number) {
  const [rows] = await pool.execute<Rows>(
    `SELECT le.LEAVEENTRYID, DATE_FORMAT(applied_date, '%Y-%m-%d') AS applied_date, LEAVESTATUS, lt.item,
            DATE_FORMAT(FROMDATE, '%Y-%m-%d') AS FROMDATE, FROMHALF, DATE_FORMAT(TODATE, '%Y-%m-%d') AS TODATE, TOHALF,
            ISAutherized, ISAPPROVED, AuthoriseRemarks, ApproveRemarks,
            ${EMP_NAME('ISAutherizedby')} AS authorized_by, DATE_FORMAT(Autherized_date, '%Y-%m-%d') AS authorized_date,
            ${EMP_NAME('APPROVEDBY')} AS approved_by, DATE_FORMAT(APPROVED_date, '%Y-%m-%d') AS approved_date,
            Reason, contact_person, leave_days
     FROM leaveentries le LEFT JOIN salary_head_items lt ON le.salary_head_item_fkey = lt.salary_head_item_pkey
     WHERE EMP_fkey = ?
       AND LEAVESTATUS IN ('Applied','Authorized','Approved','Cancelled','Rejected','CancellationOfAuthorized',
                           'Cancellation Approved','Cancellation Authorized','CancellationOfApproved')
     ORDER BY le.LEAVEENTRYID DESC`,
    [empFkey]
  );
  return {
    employee: await employeeHeader(pool, empFkey),
    rows: rows.map((r) => {
      const status = String(r.LEAVESTATUS ?? '');
      const authorized = Number(r.ISAutherized) === 1;
      const approved = Number(r.ISAPPROVED) === 1;
      const authDate = cleanDate(r.authorized_date);
      const apprDate = cleanDate(r.approved_date);
      let authBy = r.authorized_by ?? '';
      let apprBy = r.approved_by ?? '';
      // An Approved leave with neither person recorded was approved directly by Admin.
      if (status === 'Approved' && !authBy && !apprBy) { authBy = 'Admin'; apprBy = 'Admin'; }
      let rejectedBy = '', rejectedRemark = '', rejectedDate = '';
      if (status === 'Rejected') {
        if (!apprDate) { rejectedBy = r.authorized_by ?? ''; rejectedRemark = r.AuthoriseRemarks ?? ''; rejectedDate = authDate; }
        else { rejectedBy = r.approved_by ?? ''; rejectedRemark = r.ApproveRemarks ?? ''; rejectedDate = apprDate; }
      }
      const showAuthRemark = (authorized && approved) || status === 'Authorized' || status === 'Approved';
      const showApprRemark = status === 'Approved' || (authorized && approved);
      return {
        id: Number(r.LEAVEENTRYID), appliedDate: cleanDate(r.applied_date),
        from: `${r.FROMDATE ?? ''}-${halfLabel(r.FROMHALF)}`, to: `${r.TODATE ?? ''}-${halfLabel(r.TOHALF)}`,
        reason: r.Reason ?? '', handoverTo: r.contact_person ?? '',
        authorizedBy: authBy, authorizedRemark: status !== 'Applied' && showAuthRemark ? r.AuthoriseRemarks ?? '' : '',
        authorizedDate: authorized ? authDate : '',
        approvedBy: apprBy, approvedRemark: status !== 'Applied' && showApprRemark ? r.ApproveRemarks ?? '' : '',
        approvedDate: status === 'Rejected' ? '' : apprDate,
        rejectedBy, rejectedRemark, rejectedDate,
        leaveType: r.item ?? '', days: r.leave_days, status,
      };
    }),
  };
}

// leavedetailsreport('excel'): legacy's PHPExcel download. Its Excel branch uses the raw columns
// (dates without the half, the stored remarks and names as-is) — only Rejected By / Remark / Date
// are derived — so this follows that branch, not the on-screen table.
const LEAVE_EXCEL_HEADERS = [
  'Sl No', 'Applied Date', 'From Date', 'To Date', 'Reason', 'Duties Handed over To', 'Authorized By',
  'Authorized Person Remark', 'Authorized Date', 'Approved By', 'Approved Person Remark', 'Approved Date',
  'Rejected By', 'Rejected Person Remark', 'Rejected Date', 'Leave Type', 'Leave days', 'Leave Status',
];

async function leaveDetailsExcel(pool: Pool, empFkey: number) {
  const [rows] = await pool.execute<Rows>(
    `SELECT DATE_FORMAT(applied_date, '%Y-%m-%d') AS applied_date, LEAVESTATUS,
            DATE_FORMAT(FROMDATE, '%Y-%m-%d') AS FROMDATE, DATE_FORMAT(TODATE, '%Y-%m-%d') AS TODATE, lt.item,
            (SELECT CONCAT(first_name, ' ', middile_name, ' ', last_name) FROM emp_details WHERE emp_pkey = ISAutherizedby) AS authorized_by,
            DATE_FORMAT(Autherized_date, '%Y-%m-%d') AS authorized_date,
            (SELECT CONCAT(first_name, ' ', middile_name, ' ', last_name) FROM emp_details WHERE emp_pkey = APPROVEDBY) AS approved_by,
            DATE_FORMAT(APPROVED_date, '%Y-%m-%d') AS approved_date, Reason, contact_person, leave_days, AuthoriseRemarks, ApproveRemarks
     FROM leaveentries LEFT JOIN salary_head_items lt ON leaveentries.salary_head_item_fkey = lt.salary_head_item_pkey
     WHERE EMP_fkey = ?
       AND LEAVESTATUS IN ('Applied','Authorized','Approved','Cancelled','Rejected','CancellationOfAuthorized',
                           'Cancellation Approved','Cancellation Authorized','CancellationOfApproved')
     ORDER BY LEAVEENTRYID DESC`,
    [empFkey]
  );
  const [[emp]] = await pool.execute<Rows>(`SELECT CONCAT_WS(' ', first_name, last_name) AS name FROM emp_details WHERE emp_pkey = ?`, [empFkey]);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Leave Detailed Report');
  ws.getCell('A1').value = 'Leave Detailed Report';
  ws.mergeCells('A1:R1');
  ws.getCell('A1').font = { bold: true, size: 16 };
  ws.getCell('A1').alignment = { horizontal: 'center' };
  const header = ws.getRow(3);
  LEAVE_EXCEL_HEADERS.forEach((h, i) => { header.getCell(i + 1).value = h; header.getCell(i + 1).font = { bold: true }; });

  const v = (x: unknown) => (x == null ? '' : String(x));
  rows.forEach((r, i) => {
    const status = v(r.LEAVESTATUS);
    const apprDate = cleanDate(r.approved_date);
    let rejected = '', rejectedRemark = '', rejectedDate = '';
    if (status === 'Rejected') {
      if (apprDate === '') { rejected = v(r.authorized_by); rejectedRemark = v(r.AuthoriseRemarks); rejectedDate = cleanDate(r.authorized_date); }
      else { rejected = v(r.approved_by); rejectedRemark = v(r.ApproveRemarks); rejectedDate = apprDate; }
    }
    ws.getRow(4 + i).values = [
      i + 1, cleanDate(r.applied_date), v(r.FROMDATE), v(r.TODATE), v(r.Reason), v(r.contact_person),
      v(r.authorized_by), v(r.AuthoriseRemarks), cleanDate(r.authorized_date),
      v(r.approved_by), v(r.ApproveRemarks), apprDate,
      rejected, rejectedRemark, rejectedDate, v(r.item).trim(), r.leave_days == null ? '' : Number(r.leave_days), status,
    ];
  });
  // Auto-size columns (legacy setAutoSize) from the longest value below the title row.
  ws.columns.forEach((col, i) => {
    let max = LEAVE_EXCEL_HEADERS[i]?.length ?? 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      if (Number(cell.row) >= 3) max = Math.max(max, String(cell.value ?? '').length);
    });
    col.width = Math.min(max + 2, 60);
  });

  const safeName = v(emp?.name).replace(/[^A-Za-z0-9_-]/g, '') || 'LeaveReport';
  return { buffer: await wb.xlsx.writeBuffer(), fileName: `${safeName}_LeaveDetailedReport.xlsx` };
}

// Grade::Getholidays() (calendar) — the employee's holiday group, with each holiday's own colour.
async function holidays(pool: Pool, empFkey: number) {
  const [rows] = await pool.execute<Rows>(
    `SELECT HOLIDAYID, HOLIDAYNAME, DATE_FORMAT(HOLIDAYDATE, '%Y-%m-%d') AS HOLIDAYDATE, DESCRIPTION, HOLIDAYTYPE, Background, border
     FROM holidays WHERE HOLIDAY_GROUP_ID IN (SELECT HOLIDAY_GROUP_ID FROM emp_proff WHERE emp_fkey = ?)
     ORDER BY HOLIDAYDATE`,
    [empFkey]
  );
  return {
    holidays: rows.map((r) => ({
      id: Number(r.HOLIDAYID), name: r.HOLIDAYNAME as string, date: r.HOLIDAYDATE as string,
      type: r.HOLIDAYTYPE ?? '', description: r.DESCRIPTION ?? '', color: (r.Background as string) || '#3c8dbc',
    })),
  };
}

// Merge "first/second half" parts: leave beats week-off beats present, per half.
function mergeHalves(present: string, leave: string, weekoff: string) {
  const parts = (v: string) => v.replace(/ /g, '').split('/');
  const [p1 = '', p2 = ''] = parts(present);
  const [l1 = '', l2 = ''] = parts(leave);
  const [w1 = '', w2 = ''] = parts(weekoff);
  const s1 = l1 || w1 || p1;
  const s2 = l2 || w2 || p2;
  return s1 || s2 ? `${s1}/${s2}` : '';
}

function sessionCode(session: number, occ: string) {
  return session === 3 ? `${occ}/${occ}` : session === 1 ? `${occ}/` : session === 2 ? `/${occ}` : '';
}

// getattendancedays(): one calendar event per day of the attendance cycle.
async function attendance(pool: Pool, empFkey: number, companyCode: string, month: string) {
  const restricted = ATTENDANCE_RESTRICTED.includes(companyCode.toUpperCase());
  const monthStart = `${month}-01`;
  let start = monthStart;
  let end = monthEnd(month);

  const registerMap = new Map<string, RowDataPacket>();
  const holidayMap = new Map<string, string>();
  const exceptionMap = new Map<string, string>();
  const leaveMap = new Map<string, { session: number; occ: string }>();
  let sc: RowDataPacket | null = null;

  if (!restricted) {
    const [[cycle]] = await pool.query<Rows>(
      `SELECT DATE_FORMAT(att_start_end_fn(?, 1), '%Y-%m-%d') AS s, DATE_FORMAT(att_start_end_fn(?, 2), '%Y-%m-%d') AS e`,
      [monthStart, monthStart]
    );
    if (cycle?.s && cycle?.e) { start = cycle.s; end = cycle.e; }
    // Always cover the whole selected calendar month.
    if (end < monthEnd(month)) end = monthEnd(month);

    // Which register months (month_year) cover this range, given the cycle start day.
    const cycleDay = Number(start.slice(8, 10));
    const regMonthOf = (d: string) => (cycleDay > 1 && Number(d.slice(8, 10)) >= cycleDay ? addMonths(d.slice(0, 7), 1) : d.slice(0, 7));
    const [firstReg, lastReg] = [regMonthOf(start), regMonthOf(end)].sort();
    const regMonths: string[] = [];
    for (let m = firstReg; m <= lastReg; m = addMonths(m, 1)) regMonths.push(m);
    const [regs] = await pool.query<Rows>(
      `SELECT * FROM attendance_register WHERE emp_fkey = ? AND month_year IN (?) AND isdelete = 'N'`,
      [empFkey, regMonths]
    );
    for (const r of regs) registerMap.set(r.month_year as string, r);

    const [[proff]] = await pool.execute<Rows>('SELECT day_time_seq, HOLIDAY_GROUP_ID FROM emp_proff WHERE emp_fkey = ?', [empFkey]);
    if (proff?.HOLIDAY_GROUP_ID) {
      const [hs] = await pool.execute<Rows>(
        `SELECT DATE_FORMAT(HOLIDAYDATE, '%Y-%m-%d') AS d, HOLIDAYNAME FROM holidays
         WHERE HOLIDAY_GROUP_ID = ? AND status = 1 AND HOLIDAYDATE BETWEEN ? AND ?`,
        [proff.HOLIDAY_GROUP_ID, start, end]
      );
      for (const h of hs) holidayMap.set(h.d, h.HOLIDAYNAME);
    }
    if (proff?.day_time_seq) {
      const [[shiftRow]] = await pool.execute<Rows>(
        `SELECT Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, is_exception,
                Sunday_F, Monday_F, Tuesday_F, Wednesday_F, Thursday_F, Friday_F, Saturday_F
         FROM working_day_time_procedures WHERE day_time_seq = ?`,
        [proff.day_time_seq]
      );
      sc = shiftRow ?? null;
      if (sc && String(sc.is_exception) === '1') {
        const [exs] = await pool.execute<Rows>(
          'SELECT ex_week_day, ex_week, week_off FROM shift_exceptions WHERE shift_id = ? AND status = 1',
          [proff.day_time_seq]
        );
        for (const ex of exs) exceptionMap.set(`${ex.ex_week_day}|${ex.ex_week}`, ex.week_off);
      }
    }
    const [ls] = await pool.execute<Rows>(
      `SELECT DATE_FORMAT(elt.leave_date, '%Y-%m-%d') AS d, elt.leave_session, shi.occurance
       FROM emp_leave_transactions elt
       JOIN leaveentries le ON le.LEAVEENTRYID = elt.LEAVEENTRYID
       JOIN salary_head_items shi ON shi.salary_head_item_pkey = le.salary_head_item_fkey
       WHERE le.EMP_fkey = ? AND elt.Leavestatus IN ('Authorized', 'Approved') AND elt.leave_date BETWEEN ? AND ?`,
      [empFkey, start, end]
    );
    for (const l of ls) leaveMap.set(l.d, { session: Number(l.leave_session), occ: String(l.occurance ?? '') });
  }

  const [punches] = await pool.execute<Rows>(
    `SELECT DATE_FORMAT(att_date, '%Y-%m-%d') AS d, DATE_FORMAT(att_in_time, '%H:%i:%s') AS att_in_time,
            DATE_FORMAT(att_out_time, '%H:%i:%s') AS att_out_time, duration, present, weekoff, leaves, holiday, others
     FROM emp_detail_timeattandance WHERE emp_pkey = ? AND att_date BETWEEN ? AND ?`,
    [empFkey, start, end]
  );
  const punchMap = new Map(punches.map((p) => [p.d as string, p]));

  const today = todayIso();
  const cycleDay = Number(start.slice(8, 10));
  const events: { date: string; title: string; bg: string; fg: string; tooltip: string; clickable: boolean }[] = [];

  for (let date = start; date <= end; date = addDays(date, 1)) {
    const v = punchMap.get(date);
    const present = String(v?.present ?? '');
    let title = '';
    let leaveDays = '';

    if (restricted) {
      const s = v ? mergeHalves(present, String(v.leaves ?? ''), String(v.weekoff ?? '')) : '';
      title = `${s} ${v?.holiday ?? ''} ${v?.others ?? ''}`.trim();
      leaveDays = String(v?.leaves ?? '');
    } else {
      let usePrimary = true;
      if (registerMap.size > 0) {
        const day = Number(date.slice(8, 10));
        let regMonth: string;
        let idx: number;
        if (cycleDay === 1) {
          regMonth = date.slice(0, 7);
          idx = day;
        } else if (day >= cycleDay) {
          regMonth = addMonths(date.slice(0, 7), 1);
          idx = day - (cycleDay - 1);
        } else {
          regMonth = date.slice(0, 7);
          const prevLast = Number(monthEnd(addMonths(date.slice(0, 7), -1)).slice(8, 10));
          idx = prevLast - (cycleDay - 1) + day;
        }
        const regStatus = String(registerMap.get(regMonth)?.[`FIELD${idx}`] ?? '').trim();
        if (regStatus) {
          usePrimary = false;
          const l = leaveMap.get(date);
          const regLeave = l ? sessionCode(l.session, l.occ) : '';
          if (regLeave) {
            title = mergeHalves(regStatus, regLeave, '');
            leaveDays = regLeave;
          } else {
            title = regStatus;
          }
        }
      }
      if (usePrimary) {
        const l = leaveMap.get(date);
        leaveDays = l ? sessionCode(l.session, l.occ) : '';
        const holiday = holidayMap.has(date) ? 'HO' : '';
        let weekoff = '';
        if (sc) {
          const dayName = DAYS[new Date(date + 'T00:00:00Z').getUTCDay()];
          const weekIndex = Math.ceil(Number(date.slice(8, 10)) / 7);
          const exception = exceptionMap.get(`${dayName}|${weekIndex}`);
          let isWo = false;
          let isHalfWo = false;
          if (exception === 'Y') isWo = true;
          else if (exception === 'N') isWo = false;
          else { isWo = sc[dayName] === 'N'; isHalfWo = sc[`${dayName}_F`] === 'Y'; }
          weekoff = isWo ? 'WO/WO' : isHalfWo ? '/WO' : '';
        }
        title = `${mergeHalves(present, leaveDays, weekoff)} ${holiday}`.trim();
      }
    }

    const tooltip = `In-Time : ${hms(v?.att_in_time)}-Out-Time : ${hms(v?.att_out_time)} Duration :${v?.duration ?? 0} Minutes`;
    if (title === '' && date < today) {
      events.push({ date, title: '', bg: 'red', fg: 'white', tooltip, clickable: false });
    } else if (title !== '') {
      const t = title.toUpperCase();
      let bg = 'white';
      let fg = 'black';
      if (t.includes('LOP') || t.includes('A')) { bg = 'red'; fg = 'white'; }
      else if (t.includes('HO')) { bg = 'blue'; fg = 'white'; }
      else if (t.includes('WO')) { bg = 'yellow'; fg = 'black'; }
      else if (t.includes('P/P') || ['P', 'P/', '/P', 'P / P'].includes(t)) { bg = 'green'; fg = 'white'; }
      else if (leaveDays && leaveDays !== '0/0') { bg = 'orange'; fg = 'white'; }
      events.push({ date, title, bg, fg, tooltip, clickable: true });
    }
  }

  // Legend: fixed codes + one per leave type (salary_head_items of type LEAVE), as legacy.
  const [leaveTypes] = await pool.execute<Rows>(
    `SELECT UCASE(IFNULL(occurance, 'LOP')) AS abbr, item FROM salary_head_items WHERE UCASE(item_type) = 'LEAVE' AND occurance != 'LOP'`
  );
  const legend = [
    { code: 'P', label: 'Present', bg: 'green', fg: 'white' },
    { code: 'WO', label: 'Week Off', bg: 'yellow', fg: 'black' },
    { code: 'HO', label: 'Holiday', bg: 'blue', fg: 'white' },
    { code: 'A', label: 'Absent', bg: 'red', fg: 'white' },
    { code: 'LOP', label: 'Loss Of Pay', bg: 'maroon', fg: 'white' },
    { code: 'OTHERS', label: 'Others', bg: 'deepskyblue', fg: 'white' },
    ...leaveTypes.map((l) => (l.abbr === 'TC'
      ? { code: 'TC', label: 'Time Coupen', bg: '#ef00ff', fg: 'white' }
      : { code: String(l.abbr), label: String(l.item), bg: 'orange', fg: 'white' })),
  ];

  return { month, start, end, events, legend };
}

// showattendancedetails(): either one clicked day (its punches from that day's in-time to its
// out-time, plus holiday / leave / in-out summary) or, with a start/end range, the whole viewed
// month's punch log.
async function attendanceDay(pool: Pool, empFkey: number, date: string | null, range: { start: string; end: string } | null) {
  const [[emp]] = await pool.execute<Rows>(
    `SELECT e.emp_id, i.EmpName, i.employee_id, i.branch FROM emp_details e
     LEFT JOIN employee_info i ON i.emp_pkey = e.emp_pkey WHERE e.emp_pkey = ?`,
    [empFkey]
  );

  let from = '';
  let to = '';
  let summary: { inTime: string; outTime: string; duration: string } | null = null;
  let holiday: string | null = null;
  let leaves: { code: string; type: string; status: string; session: string; remarks: string; authorizedBy: string; authorizedDate: string; approvedBy: string; approvedDate: string }[] = [];

  if (date) {
    const [[day]] = await pool.execute<Rows>(
      `SELECT DATE_FORMAT(att_in_time, '%Y-%m-%d %H:%i:%s') AS in_time, DATE_FORMAT(att_out_time, '%Y-%m-%d %H:%i:%s') AS out_time, duration
       FROM emp_detail_timeattandance WHERE att_date = ? AND emp_pkey = ?`,
      [date, empFkey]
    );
    if (day?.in_time) {
      from = day.in_time;
      to = day.out_time || `${day.in_time.slice(0, 10)} 23:23:00`;
      summary = { inTime: hmAmPm(day.in_time.slice(11)), outTime: day.out_time ? hmAmPm(day.out_time.slice(11)) : '', duration: day.duration != null ? String(day.duration) : '' };
    }
    const [[hol]] = await pool.execute<Rows>(
      `SELECT HOLIDAYNAME FROM holidays WHERE status = 1 AND DATE(HOLIDAYDATE) = ?
         AND HOLIDAY_GROUP_ID = (SELECT HOLIDAY_GROUP_ID FROM emp_proff WHERE emp_fkey = ?) LIMIT 1`,
      [date, empFkey]
    );
    holiday = (hol?.HOLIDAYNAME as string) ?? null;
    const [ls] = await pool.execute<Rows>(
      `SELECT elt.leave_session, elt.Leavestatus, elt.Remarks, shi.occurance, shi.item,
              DATE_FORMAT(le.Autherized_date, '%Y-%m-%d') AS auth_date, DATE_FORMAT(le.APPROVED_date, '%Y-%m-%d') AS appr_date,
              ${EMP_NAME('le.ISAutherizedby')} AS authorized_by, ${EMP_NAME('le.APPROVEDBY')} AS approved_by
       FROM emp_leave_transactions elt
       JOIN leaveentries le ON le.LEAVEENTRYID = elt.LEAVEENTRYID
       JOIN salary_head_items shi ON shi.salary_head_item_pkey = le.salary_head_item_fkey
       WHERE le.EMP_fkey = ? AND DATE(elt.leave_date) = ? AND elt.Leavestatus IN ('Applied', 'Authorized', 'Approved')`,
      [empFkey, date]
    );
    leaves = ls.map((l) => ({
      code: l.occurance ?? '', type: l.item ?? '', status: l.Leavestatus ?? '', remarks: l.Remarks ?? '',
      session: Number(l.leave_session) === 2 ? 'Second Half' : Number(l.leave_session) === 1 ? 'First Half' : 'Full Day',
      authorizedBy: String(l.authorized_by ?? '').trim(), authorizedDate: cleanDate(l.auth_date),
      approvedBy: String(l.approved_by ?? '').trim(), approvedDate: cleanDate(l.appr_date),
    }));
  } else if (range) {
    from = range.start;
    to = range.end;
  }

  let punches: { date: string; time: string; status: string; location: string }[] = [];
  let shiftSeq = 0;
  if (from && to) {
    const [rows] = await pool.execute<Rows>(
      `SELECT DATE_FORMAT(LOGDATE, '%Y-%m-%d') AS d, DATE_FORMAT(LOGDATE, '%H:%i:%s') AS t, C1, C3, SHIFT
       FROM device_attandance WHERE status = 'Y' AND LOGDATE BETWEEN ? AND ? AND emp_id = ? ORDER BY LOGDATE`,
      [from, to, emp?.emp_id ?? '']
    );
    punches = rows.map((r) => ({ date: r.d, time: hmAmPm(r.t), status: r.C1 ?? '', location: r.C3 || emp?.branch || '' }));
    shiftSeq = Number(rows[0]?.SHIFT) || 0;
  }
  // Shift name: the punches' shift, falling back to the employee's assigned shift.
  if (!shiftSeq) {
    const [[p]] = await pool.execute<Rows>('SELECT day_time_seq FROM emp_proff WHERE emp_fkey = ? LIMIT 1', [empFkey]);
    shiftSeq = Number(p?.day_time_seq) || 0;
  }
  let shiftName = '';
  if (shiftSeq) {
    const [[sh]] = await pool.execute<Rows>('SELECT day_time_desc FROM working_day_time_procedures WHERE day_time_seq = ? LIMIT 1', [shiftSeq]);
    shiftName = String(sh?.day_time_desc ?? '').trim();
  }

  return {
    date,
    employee: { name: emp?.EmpName ?? '', id: emp?.employee_id ?? '', branch: emp?.branch ?? '', shift: shiftName },
    punches,
    // In/out chips only when the punches are all on one day.
    summary: punches.length && summary && punches[0].date === punches[punches.length - 1].date ? summary : null,
    holiday,
    leaves,
  };
}

// showattendancedetails' DataTables "Excel" button: the punch table as shown — title
// "Attendance Logs - {name}", "Period: {first} [to {last}]" underneath, then Date / Time / Status /
// Location with dates as 'd M Y' and times as 'h:i A' — saved as "{title}.xlsx".
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dMY = (iso: string) => (iso ? `${iso.slice(8, 10)} ${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '');

async function attendanceExcel(details: Awaited<ReturnType<typeof attendanceDay>>) {
  const { punches, employee } = details;
  const first = dMY(punches[0]?.date ?? '');
  const last = dMY(punches[punches.length - 1]?.date ?? '');
  const title = `Attendance Logs - ${employee.name}`;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  const headers = ['Date', 'Time', 'Status', 'Location'];
  ws.getCell('A1').value = title;
  ws.mergeCells('A1:D1');
  ws.getCell('A1').font = { bold: true };
  ws.getCell('A1').alignment = { horizontal: 'center' };
  ws.getCell('A2').value = `Period: ${first}${first !== last ? ` to ${last}` : ''}`;
  ws.mergeCells('A2:D2');
  const head = ws.getRow(3);
  headers.forEach((h, i) => { head.getCell(i + 1).value = h; head.getCell(i + 1).font = { bold: true }; });
  punches.forEach((p, i) => { ws.getRow(4 + i).values = [dMY(p.date), p.time, p.status, p.location]; });
  ws.columns.forEach((col, i) => {
    let max = headers[i].length;
    punches.forEach((p) => { max = Math.max(max, String([dMY(p.date), p.time, p.status, p.location][i] ?? '').length); });
    col.width = max + 4;
  });
  // DataTables names the file after the title; keep it filesystem-safe.
  const fileName = `${title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()}.xlsx`;
  return { buffer: await wb.xlsx.writeBuffer(), fileName };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const empFkey = Number(session.user.empFkey);
  if (!empFkey) return NextResponse.json({ error: 'Reports are available to employee logins only' }, { status: 400 });

  const { report } = await params;
  const sp = request.nextUrl.searchParams;
  const pool = await getCompanyPool(session.user.companyCode);
  const companyCode = session.user.companyCode ?? '';

  switch (report) {
    case 'salary':
      return NextResponse.json(await salary(pool, empFkey));
    case 'shift':
      return NextResponse.json(await shift(pool, empFkey));
    case 'leave-policy':
      return NextResponse.json(await leavePolicy(pool, empFkey, companyCode));
    case 'leave-entry': {
      const entry = await leaveEntry(pool, empFkey, Number(sp.get('id')));
      return entry ? NextResponse.json(entry) : NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    case 'leave-details':
      return NextResponse.json(await leaveDetails(pool, empFkey));
    case 'leave-details-excel': {
      const { buffer, fileName } = await leaveDetailsExcel(pool, empFkey);
      return new NextResponse(buffer as ArrayBuffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    case 'attendance-excel': {
      const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
      const date = sp.get('date');
      const start = sp.get('start');
      const end = sp.get('end');
      const details = isDate(date)
        ? await attendanceDay(pool, empFkey, date, null)
        : isDate(start) && isDate(end) ? await attendanceDay(pool, empFkey, null, { start, end }) : null;
      if (!details) return NextResponse.json({ error: 'date, or start and end, must be YYYY-MM-DD' }, { status: 400 });
      const { buffer, fileName } = await attendanceExcel(details);
      return new NextResponse(buffer as ArrayBuffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          'Cache-Control': 'no-store',
        },
      });
    }
    case 'holidays':
      return NextResponse.json(await holidays(pool, empFkey));
    case 'attendance': {
      const month = sp.get('month') ?? '';
      if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
      return NextResponse.json(await attendance(pool, empFkey, companyCode, month));
    }
    case 'attendance-day': {
      const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
      const date = sp.get('date');
      const start = sp.get('start');
      const end = sp.get('end');
      if (isDate(date)) return NextResponse.json(await attendanceDay(pool, empFkey, date, null));
      if (isDate(start) && isDate(end)) return NextResponse.json(await attendanceDay(pool, empFkey, null, { start, end }));
      return NextResponse.json({ error: 'date, or start and end, must be YYYY-MM-DD' }, { status: 400 });
    }
    default:
      return NextResponse.json({ error: 'Unknown report' }, { status: 404 });
  }
}

// The Attendance/Leave Report's Refresh button. Ported from EmpreportController::refresh(), not
// EmpreportNew's copy: EmpreportNew clears the month's unverified day records and then calls
// time_duration_check once with the month's first date — but that function recomputes a single
// date, so every other day of the month was left deleted. Empreport's version (the later fix)
// recomputes each shift date that has device punches, and keeps the clear-and-rebuild-by-month
// path only for the companies it lists.
const REFRESH_BY_MONTH_COMPANIES = ['ABSG', 'VGFS', 'VSFS', 'DRRC', 'DJIC', 'AGNG', 'AYRK', 'GTRA', 'VGNN', 'SHYD', 'SRTS'];

async function refreshAttendance(pool: Pool, empFkey: number, companyCode: string, month: string) {
  const [[endRow]] = await pool.query<Rows>(`SELECT DATE_FORMAT(att_start_end_fn(?, 2), '%Y-%m-%d') AS e`, [`${month}-01`]);
  const cycleMonth = `${String(endRow?.e ?? `${month}-01`).slice(0, 7)}-01`;
  const [[cycle]] = await pool.query<Rows>(
    `SELECT DATE_FORMAT(att_start_end_fn(?, 1), '%Y-%m-%d') AS s, DATE_FORMAT(att_start_end_fn(?, 2), '%Y-%m-%d') AS e`,
    [cycleMonth, cycleMonth]
  );
  const [[emp]] = await pool.execute<Rows>('SELECT emp_id, branch_code FROM employee_info WHERE emp_pkey = ?', [empFkey]);
  if (!emp) return { success: false, message: 'Employee not found' };

  if (REFRESH_BY_MONTH_COMPANIES.includes(companyCode.toUpperCase())) {
    const [[sh]] = await pool.execute<Rows>(
      'SELECT is_multiple_days FROM working_day_time_procedures WHERE day_time_seq IN (SELECT day_time_seq FROM emp_proff WHERE emp_fkey = ?)',
      [empFkey]
    );
    const fn = sh?.is_multiple_days === 'Y' ? 'time_duration_check_multishift' : 'time_duration_check';
    const months = [cycleMonth, `${addMonths(cycleMonth.slice(0, 7), 1)}-01`, `${addMonths(cycleMonth.slice(0, 7), 2)}-01`];
    for (const m of months) {
      await pool.execute(
        `DELETE FROM emp_detail_timeattandance WHERE emp_pkey = ? AND yearmonth = ?
           AND emp_pkey NOT IN (SELECT emp_fkey FROM attendance_register WHERE isdelete = 'N' AND month_year = DATE_FORMAT(?, '%Y-%m'))`,
        [empFkey, m, cycleMonth]
      );
      await pool.query(`SELECT ${fn}(?, ?, ?) AS r`, [m, empFkey, emp.branch_code]);
    }
    return { success: true };
  }

  const [dates] = await pool.execute<Rows>(
    `SELECT DISTINCT DATE_FORMAT(SHIFTDATE, '%Y-%m-%d') AS d FROM device_attandance
     WHERE emp_id = ? AND SHIFTDATE BETWEEN ? AND ? AND status = 'Y' ORDER BY d`,
    [emp.emp_id, cycle?.s, cycle?.e]
  );
  if (dates.length === 0) return { success: false, message: 'No attendance found for this period' };
  for (const r of dates) await pool.query('SELECT time_duration_check(?, ?, ?) AS r', [r.d, empFkey, emp.branch_code]);
  return { success: true };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const empFkey = Number(session.user.empFkey);
  if (!empFkey) return NextResponse.json({ error: 'Reports are available to employee logins only' }, { status: 400 });

  const { report } = await params;
  if (report !== 'attendance-refresh') return NextResponse.json({ error: 'Unknown report' }, { status: 404 });
  const { month } = (await request.json().catch(() => ({}))) as { month?: string };
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });

  const pool = await getCompanyPool(session.user.companyCode);
  return NextResponse.json(await refreshAttendance(pool, empFkey, session.user.companyCode ?? '', month));
}
