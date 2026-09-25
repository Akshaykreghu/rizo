// Seeds the LOCAL GRTL company DB so the employee home page (/ess) has something in every
// section. Written for Priya Nair (GRTL100012, emp 2, password Test@12345), whose "My team" is
// her manager Arjun (emp 1) plus his other reports.
//
//   node scripts/seed-ess-home.mjs        (dev server must be running on :3000)
//
// Dates are relative to the day it runs, so re-run it on another day to line the calendar,
// punches and leave back up with "today". Safe to re-run: every step skips what already exists.
//
// Goes through the app's own APIs (as GRTLADMIN) wherever an admin flow exists — employees,
// holidays, announcements, leave (so leave_transaction_prc writes emp_leave_transactions and
// balances). Direct SQL is used only where there is no create API: past punches/day records,
// and single-column updates (birthdays, joining dates, emergency contact, shift/policy groups)
// where the employee PUT would full-replace the row.

import mysql from 'mysql2/promise';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DB = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'RizoLocal123!',
  database: process.env.DB_NAME || 'mypayrol_mpm121',
  dateStrings: true,
};
if (!['localhost', '127.0.0.1'].includes(DB.host) || !/localhost|127\.0\.0\.1/.test(BASE)) {
  console.error('Refusing to run: this seed is for the local DB and dev server only.');
  process.exit(1);
}

const PASSWORD = 'Test@12345';
const SHIFT = 135;
const SHIFT_STRING = '135(Test)-9:00:00 17:00:00 480 240 N';
const WORKDAYS = { 0: false, 1: true, 2: true, 3: true, 4: false, 5: true, 6: true }; // shift 135: Thu + Sun off
const HOLIDAY_GROUP = 2;
const LEAVE_POLICY_GROUP = 4;
const LEAVE_TYPES = [87, 86, 144, 164]; // CL, SL, AL, LOP — first one the proc accepts wins

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = new Date(); today.setHours(0, 0, 0, 0);
const TODAY = iso(today);
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
const log = (...a) => console.log(' ', ...a);

// ── admin session via the real NextAuth credentials flow ──────────────────────────────────────
async function login(username) {
  const jar = new Map();
  const keep = (res) => {
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  let r = await fetch(`${BASE}/api/auth/csrf`);
  keep(r);
  const { csrfToken } = await r.json();
  r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookie() },
    body: new URLSearchParams({ csrfToken, username, password: PASSWORD, json: 'true' }),
    redirect: 'manual',
  });
  keep(r);
  const session = await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie: cookie() } })).json();
  if (!session?.user) throw new Error(`Login failed for ${username}`);
  return async (path, method = 'GET', body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', cookie: cookie() },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

const db = await mysql.createConnection(DB);
const q = async (sql, params = []) => (await db.query(sql, params))[0];
const admin = await login('GRTLADMIN');

// ── 1. New joiners this month (also join Priya's team: they report to Arjun) ─────────────────
console.log('New joiners');
const joinDay = (daysAgo) => iso(addDays(today, -daysAgo) < monthStart ? monthStart : addDays(today, -daysAgo));
const JOINERS = [
  { first_name: 'Meera', last_name: 'Joseph', classification: 'female', date_of_birth: '1998-04-12', id_card: '900000000017', mobile_no: '9847000017', email: 'meera.joseph@example.com', emp_dept: 'DM', designation: 'CRM', joining_date: joinDay(14) },
  { first_name: 'Vivek', last_name: 'Nambiar', classification: 'male', date_of_birth: '1996-12-03', id_card: '900000000018', mobile_no: '9847000018', email: 'vivek.nambiar@example.com', emp_dept: 'Acc', designation: 'DAC', joining_date: joinDay(3) },
];
const joinerIds = [];
for (const j of JOINERS) {
  let [row] = await q('SELECT emp_pkey FROM emp_details WHERE first_name = ? AND last_name = ?', [j.first_name, j.last_name]);
  if (!row) {
    const r = await admin('/api/employees', 'POST', {
      ...j, blood: 'B+', maritual_status: 'Single', emp_branch: 'GRTL08', attr1: '1',
    });
    if (r.status >= 300) throw new Error(`Create ${j.first_name}: ${r.status} ${JSON.stringify(r.body)}`);
    [row] = await q('SELECT emp_pkey FROM emp_details WHERE first_name = ? AND last_name = ?', [j.first_name, j.last_name]);
    log(`created ${j.first_name} ${j.last_name} (emp ${row.emp_pkey}), joined ${j.joining_date}`);
  } else log(`${j.first_name} ${j.last_name} exists (emp ${row.emp_pkey})`);
  await q('UPDATE emp_proff SET joining_date = ?, day_time_seq = ?, HOLIDAY_GROUP_ID = ?, LEAVEPOLICY_GROUP_ID = ? WHERE emp_fkey = ?',
    [j.joining_date, SHIFT, HOLIDAY_GROUP, LEAVE_POLICY_GROUP, row.emp_pkey]);
  joinerIds.push({ emp_pkey: Number(row.emp_pkey), joining: j.joining_date });
}

// ── 2. Birthdays + work anniversaries in the calendar's week (today → +6) and next week ───────
console.log('Celebrations');
const md = (d) => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const setDob = async (emp, d) => {
  await q("UPDATE emp_details SET date_of_birth = CONCAT(YEAR(date_of_birth), '-', ?) WHERE emp_pkey = ?", [md(d), emp]);
  log(`emp ${emp} birthday → ${md(d)}`);
};
await setDob(3, today);             // Rahul — today, so the Wish button shows
await setDob(4, addDays(today, 3)); // Sneha — later this week
await setDob(1, addDays(today, 10)); // Arjun — shows as the "Next week" hint
const anniv = async (emp, d, years) => {
  await q('UPDATE emp_proff SET joining_date = ? WHERE emp_fkey = ?', [`${d.getFullYear() - years}-${md(d)}`, emp]);
  log(`emp ${emp} joining → ${d.getFullYear() - years}-${md(d)} (${years}-year anniversary)`);
};
await anniv(1, addDays(today, 5), 5); // Arjun
await anniv(5, addDays(today, 6), 3); // Kiran

// ── 3. Holidays (Upcoming holidays card) ──────────────────────────────────────────────────────
console.log('Holidays');
const HOLIDAYS = [
  ['Gandhi Jayanti', '2026-10-02'], ['Dussehra', '2026-10-20'], ['Diwali', '2026-11-08'],
  ['Christmas', '2026-12-25'], ['Republic Day', '2027-01-26'], ['Holi', '2027-03-22'],
];
for (const [name, date] of HOLIDAYS.filter(([, d]) => d >= TODAY)) {
  const r = await admin(`/api/setup/holidays?groupId=${HOLIDAY_GROUP}`, 'POST', { HOLIDAYNAME: name, HOLIDAYDATE: date, DESCRIPTION: name });
  log(`${name} ${date}: ${r.status === 409 ? 'exists' : r.status < 300 ? 'added' : `failed ${r.status} ${JSON.stringify(r.body)}`}`);
}

// ── 4. Announcements (Company updates) ────────────────────────────────────────────────────────
console.log('Announcements');
const ANNOUNCEMENTS = [
  { title: 'Heavy rain alert — work from home on Monday', message: 'IMD has issued an orange alert for the district. All staff should work from home on Monday. Managers will share the on-call roster by Sunday evening.', category: 'Emergency', isPinned: false, audienceType: 'ALL', expiresOn: iso(addDays(today, 4)) },
  { title: 'Q3 performance reviews are open', message: 'Self-appraisals for July–September are open in the Performance module. Please submit yours by 10 October so managers can complete reviews before the calibration meeting.', category: 'Important', isPinned: true, audienceType: 'ALL', expiresOn: iso(addDays(today, 15)) },
  { title: 'Submit your investment declarations', message: 'Payroll needs your 80C/80D investment declarations for this financial year. Upload proofs under My Documents before the 5th of next month to avoid higher TDS.', category: 'Important', isPinned: false, audienceType: 'ALL', expiresOn: null },
  { title: 'Digital marketing sprint planning', message: 'Sprint planning for the festive campaign is on Tuesday at 11:00 in the main conference room. Bring your channel numbers from last quarter.', category: 'Important', isPinned: false, audienceType: 'DEPARTMENT', targets: ['DM'], expiresOn: iso(addDays(today, 7)) },
  { title: 'Town hall — 30 September, 4 PM', message: 'Leadership will share the half-year results and the plan for Q4. Join in person in the cafeteria or on the video link sent to your email.', category: 'Information', isPinned: false, audienceType: 'ALL', expiresOn: null },
  { title: 'New health insurance partner from October', message: 'Our group health cover moves to a new insurer from 1 October. E-cards will be emailed next week; existing coverage and dependants carry over unchanged.', category: 'Information', isPinned: false, audienceType: 'ALL', expiresOn: null },
  { title: 'Diwali celebration — save the date', message: 'Join us for lights, sweets and the rangoli contest on the evening before Diwali. Teams can register for the contest with the HR desk.', category: 'Information', isPinned: false, audienceType: 'ALL', expiresOn: '2026-11-08' },
];
for (const a of ANNOUNCEMENTS) {
  const [exists] = await q('SELECT 1 FROM announcements WHERE title = ? AND active = 1', [a.title]);
  if (exists) { log(`exists: ${a.title}`); continue; }
  const r = await admin('/api/announcements', 'POST', { targets: [], ...a, publishFrom: TODAY });
  log(`${r.status < 300 ? 'added' : `failed ${r.status} ${JSON.stringify(r.body)}`}: ${a.title}`);
}

// ── 5. Emergency contact (completes the profile checklist) ────────────────────────────────────
console.log('Emergency contacts');
for (const emp of [1, 2, 3, 4, 5]) {
  const [has] = await q("SELECT 1 FROM emp_family WHERE emp_fkey = ? AND emergency_contact = 'Y'", [emp]);
  if (has) continue;
  const r = await q("UPDATE emp_family SET emergency_contact = 'Y' WHERE emp_fkey = ? AND relation IN ('Spouse', 'Father') ORDER BY relation = 'Spouse' DESC LIMIT 1", [emp]);
  if (r.affectedRows) log(`emp ${emp}: emergency contact set`);
}

// ── 6. Leave: Priya earlier this month, Rahul today (Team → "On leave") ───────────────────────
// Booked before the punches below, because the leave API refuses dates that already have punches.
console.log('Leave');
const workingDaysThisMonth = [];
for (let d = new Date(monthStart); d < today; d = addDays(d, 1)) if (WORKDAYS[d.getDay()]) workingDaysThisMonth.push(iso(d));
const priyaLeaveDay = workingDaysThisMonth[5];
const priyaAbsentDay = workingDaysThisMonth[2];
const priyaLateDays = new Set([workingDaysThisMonth[1], workingDaysThisMonth[7]]);
async function applyLeave(emp, date, reason) {
  const [existing] = await q(
    "SELECT LEAVESTATUS FROM leaveentries WHERE EMP_fkey = ? AND ? BETWEEN FROMDATE AND TODATE AND LEAVESTATUS IN ('Applied', 'Authorized', 'Approved')",
    [emp, date]
  );
  if (existing) return log(`emp ${emp} ${date}: already ${existing.LEAVESTATUS}`);
  for (const type of LEAVE_TYPES) {
    const r = await admin('/api/leave/requests', 'POST', {
      empFkey: emp, salaryHeadItemFkey: type, fromDate: date, fromHalf: 1, toDate: date, toHalf: 2, reason,
    });
    if (r.status < 300 && r.body?.status === 'Approved') return log(`emp ${emp} ${date}: approved (type ${type})`);
    // The proc can leave a 'Can not Apply' row behind — clear it before trying the next type.
    if (r.body?.id) {
      await q('DELETE FROM emp_leave_transactions WHERE LEAVEENTRYID = ?', [r.body.id]);
      await q('DELETE FROM leaveentries WHERE LEAVEENTRYID = ?', [r.body.id]);
    }
    if (r.status === 409 && !r.body?.id) return log(`emp ${emp} ${date}: skipped — ${r.body?.error}`);
  }
  log(`emp ${emp} ${date}: no leave type accepted`);
}
if (priyaLeaveDay) await applyLeave(2, priyaLeaveDay, 'Family function');
await applyLeave(3, TODAY, 'Birthday leave');

// ── 7. Punches + day records: every working day this month, and today's check-ins ─────────────
console.log('Attendance');
const [empRows] = await db.query('SELECT emp_pkey, emp_id FROM emp_details WHERE emp_pkey IN (?)', [[1, 2, 3, 4, 5, ...joinerIds.map((j) => j.emp_pkey)]]);
const empCode = new Map(empRows.map((r) => [Number(r.emp_pkey), r.emp_id]));
const leaveDates = new Set((await q(
  `SELECT le.EMP_fkey AS emp, DATE_FORMAT(elt.leave_date, '%Y-%m-%d') AS d FROM emp_leave_transactions elt
   JOIN leaveentries le ON le.LEAVEENTRYID = elt.LEAVEENTRYID WHERE elt.leave_date >= ?`, [iso(monthStart)]
)).map((r) => `${r.emp}:${r.d}`));
const holidaySet = new Set((await q("SELECT DATE_FORMAT(HOLIDAYDATE, '%Y-%m-%d') AS d FROM holidays WHERE HOLIDAY_GROUP_ID = ? AND status = 1", [HOLIDAY_GROUP])).map((r) => r.d));

async function punchDay(emp, date, inHm, outHm) {
  const [have] = await q('SELECT 1 FROM emp_detail_timeattandance WHERE emp_pkey = ? AND att_date = ?', [emp, date]);
  if (have) return false;
  const code = empCode.get(emp);
  const inAt = `${date} ${inHm}:00`;
  const outAt = outHm ? `${date} ${outHm}:00` : null;
  const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
  const duration = outHm ? toMin(outHm) - toMin(inHm) : null;
  const punch = (at, dir) => q(
    `INSERT INTO device_attandance (company_code, branch_code, emp_id, LOGDATE, DIRECTION, SHIFT, SHIFTDATE, C1, C2, status)
     VALUES ('GRTL', 'GRTL08', ?, ?, ?, ?, ?, ?, 'MAN', 'Y')`, [code, at, dir, String(SHIFT), date, dir]);
  await punch(inAt, 'in');
  if (outAt) await punch(outAt, 'out');
  await q(
    `INSERT INTO emp_detail_timeattandance (emp_pkey, att_date, att_in_time, att_out_time, duration, present, yearmonth, isdelete, shift_string, day_time_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Y', ?, ?)`,
    [emp, date, inAt, outAt, duration, outAt ? 'P/P' : null, `${date.slice(0, 7)}-01`, SHIFT_STRING, SHIFT]
  );
  return true;
}

let added = 0;
for (const emp of empCode.keys()) {
  const joined = joinerIds.find((j) => j.emp_pkey === emp)?.joining ?? '0000-00-00';
  for (const [i, date] of workingDaysThisMonth.entries()) {
    if (date < joined || holidaySet.has(date) || leaveDates.has(`${emp}:${date}`)) continue;
    if (emp === 2 && (date === priyaAbsentDay || date === priyaLeaveDay)) continue;
    if (emp === 5 && i === 4) continue; // Kiran: one absence
    const late = emp === 2 && priyaLateDays.has(date);
    const m = (emp * 3 + i * 7) % 12; // a few minutes' spread so days don't look identical
    const inHm = late ? `10:${pad(10 + m)}` : `${pad(8 + (m > 6 ? 1 : 0))}:${pad(m > 6 ? m - 6 : 50 + m)}`;
    const outHm = late ? `18:${pad(40 + m)}` : `${pad(17 + (m > 3 ? 1 : 0))}:${pad((m * 5) % 60)}`;
    if (await punchDay(emp, date, inHm, outHm)) added++;
  }
}
// Today: Arjun, Sneha and Meera are in; Kiran and Vivek not yet; Rahul is on leave.
for (const [emp, hm] of [[1, '08:52'], [4, '09:07'], [joinerIds[0]?.emp_pkey, '09:15']]) {
  if (emp && WORKDAYS[today.getDay()] && (await punchDay(emp, TODAY, hm, null))) added++;
}
log(`${added} day record(s) added`);

await db.end();
console.log(`\nDone. Log in at ${BASE}/employee-login as GRTL100012 / ${PASSWORD} (Priya Nair).`);
