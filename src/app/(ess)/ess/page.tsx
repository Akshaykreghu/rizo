'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { photoUrl } from '@/lib/utils';

// Employee home. Layout follows the "Home — desktop" design reference (hero with a punch card,
// four stat cards, company updates + leadership strip beside a profile/team rail, and a
// celebrations week calendar) while keeping this app's own colours — brand #1E516E, the existing
// hero gradient and the theme's CSS variables — so light/dark mode keep working.
// Company Updates lists the announcements an admin has addressed to this employee
// (/api/ess/announcements). There is no leadership-message feature yet, so that strip always
// shows its empty state rather than made-up content.

// Theme variables: #1E516E in light mode, a lighter blue in dark mode so text stays readable.
const BRAND = 'var(--brand)';
const BRAND_DIM = 'var(--brand-dim)';
const HERO_GRADIENT = 'linear-gradient(135deg, #071520 0%, #0d2c40 30%, #1E516E 65%, #2772a0 100%)';
const AMBER = '#d97706';
const GREEN = '#16a34a';
const RED = '#dc2626';
const BDAY = '#d97706';
const ANNIV = '#7c3aed';

const ANNOUNCEMENT_TABS = ['all', 'emergency', 'important', 'info', 'pinned'] as const;
type AnnouncementTab = (typeof ANNOUNCEMENT_TABS)[number];
const ANNOUNCEMENT_TAB_LABEL: Record<AnnouncementTab, string> = {
  all: 'All', emergency: 'Urgent', important: 'Important', info: 'Info', pinned: 'Pinned',
};
interface Announcement {
  announcement_pkey: number;
  title: string;
  message: string;
  category: 'Emergency' | 'Important' | 'Information';
  is_pinned: boolean;
  publish_from: string;
  expires_on: string | null;
  is_read: boolean;
}
const CATEGORY_STYLE: Record<Announcement['category'], { color: string; bg: string; border: string; icon: string }> = {
  Emergency: { color: '#dc2626', bg: '#fef2f2', border: '#fecaca', icon: '🚨' },
  Important: { color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: '⭐' },
  Information: { color: '#1E516E', bg: '#eff6fb', border: '#cfe2ee', icon: 'ℹ️' },
};
function matchesTab(a: Announcement, tab: AnnouncementTab) {
  if (tab === 'all') return true;
  if (tab === 'pinned') return a.is_pinned;
  if (tab === 'emergency') return a.category === 'Emergency';
  if (tab === 'important') return a.category === 'Important';
  return a.category === 'Information';
}

type Employee = Record<string, string | number | null | undefined>;
interface CompanyInfo { business_name?: string }
interface Holiday { HOLIDAYID: number; HOLIDAYNAME: string; HOLIDAYDATE: string }
interface FamilyMember { is_emergency_contact?: string | null; emergency_contact?: string | null }
interface EducationRow { education_pkey: number }
interface PersonalDoc { document_type: string; valid_till: string | null }
interface EventPerson { emp_pkey: number; first_name: string; last_name: string | null; desig_name: string | null; dept_name: string | null; date_of_birth?: string; joining_date?: string }
interface PunchStatus { checkedIn: boolean; elapsedSeconds: number; lastPunch: { time: string; direction: 'in' | 'out' } | null }
interface LeaveBalance { salaryHeadItemFkey: number; name: string; balance: number }
interface HomeSummary {
  week: { days: { date: string; minutes: number; working: boolean; future: boolean }[]; workedMins: number; targetMins: number };
  month: { workingDays: number; present: number; late: number; onLeave: number; absent: number };
  team: { emp_pkey: number; name: string; emp_code: string; profile_pic: string | null; status: 'in' | 'leave' | 'off' | 'notin' }[];
}

function getInitials(a?: string | null, b?: string | null) {
  return ((a?.[0] || '') + (b?.[0] || '')).toUpperCase() || '?';
}
function fmtFull(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function daysUntil(dateStr: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}
function timeToMins(t?: string | null) {
  const m = String(t ?? '').match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function fmtTime(t?: string | null) {
  const mins = timeToMins(t);
  if (mins == null) return null;
  const h = Math.floor(mins / 60), mn = String(mins % 60).padStart(2, '0');
  return `${h % 12 || 12}:${mn} ${h >= 12 ? 'PM' : 'AM'}`;
}
function fmtElapsed(totalSecs: number) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(totalSecs / 3600))}:${pad(Math.floor((totalSecs % 3600) / 60))}:${pad(Math.floor(totalSecs % 60))}`;
}
function fmtHm(mins: number) {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
const isYes = (v: unknown) => String(v ?? '').toUpperCase() === 'Y';
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Profile checklist — same fields as before; Bank account and PAN are flagged as payroll blockers.
function computeCompleteness(emp: Employee | null, family: FamilyMember[], education: EducationRow[]) {
  if (!emp) return { score: 0, missing: [] as { label: string; payroll: boolean }[], total: 0 };
  const checks = [
    { label: 'Bank account', done: !!emp.account_no, payroll: true },
    { label: 'PAN number', done: !!emp.pan_no, payroll: true },
    { label: 'Aadhaar / ID card', done: !!emp.id_card, payroll: false },
    { label: 'Emergency contact', done: family.some((f) => isYes(f.is_emergency_contact) || isYes(f.emergency_contact)), payroll: false },
    { label: 'Blood group', done: !!emp.blood, payroll: false },
    { label: 'Education record', done: education.length > 0, payroll: false },
    { label: 'Date of birth', done: !!emp.date_of_birth, payroll: false },
    { label: 'Gender', done: !!emp.classification, payroll: false },
    { label: 'Mobile number', done: !!emp.mobile_no, payroll: false },
    { label: 'Address', done: !!emp.address, payroll: false },
  ];
  const done = checks.filter((c) => c.done).length;
  return { score: Math.round((done / checks.length) * 100), missing: checks.filter((c) => !c.done).map(({ label, payroll }) => ({ label, payroll })), total: checks.length };
}

// ── small shared pieces ─────────────────────────────────────────────────────────────────────
const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 18, boxShadow: '0 10px 24px -20px rgba(20,23,26,0.5)' };
const h2: React.CSSProperties = { fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' };
const linkStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: BRAND, textDecoration: 'none' };
const muted: React.CSSProperties = { color: 'var(--text-muted)' };

function Ring({ size, stroke, pct, color, children }: { size: number; stroke: number; pct: number; color: string; children: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, pct)))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
    </div>
  );
}

function IconBox({ bg, children }: { bg: string; children: React.ReactNode }) {
  return <span style={{ width: 30, height: 30, borderRadius: 9, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>{children}</span>;
}

function Avatar({ name, pic, size = 36, bg = BRAND_DIM, fg = BRAND }: { name: string; pic?: string | null; size?: number; bg?: string; fg?: string }) {
  const src = photoUrl(pic);
  const parts = name.trim().split(/\s+/);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', background: bg, color: fg, fontSize: size * 0.34, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {getInitials(parts[0], parts.length > 1 ? parts[parts.length - 1] : '')}
    </span>
  );
}

const TEAM_STATUS: Record<HomeSummary['team'][number]['status'], { label: string; color: string; bg: string }> = {
  in: { label: 'In office', color: GREEN, bg: 'rgba(22,163,74,0.1)' },
  leave: { label: 'On leave', color: AMBER, bg: 'rgba(217,119,6,0.12)' },
  off: { label: 'Off today', color: BRAND, bg: BRAND_DIM },
  notin: { label: 'Not in yet', color: 'var(--text-muted)', bg: 'var(--bg-page)' },
};

interface CalEvent { key: string; name: string; kind: 'birthday' | 'anniversary'; years?: number }

export default function EssHomePage() {
  const { data: session } = useSession();
  const empId = session?.user.empFkey;

  const [loading, setLoading] = useState(true);
  const [emp, setEmp] = useState<Employee | null>(null);
  const [docs, setDocs] = useState<PersonalDoc[]>([]);
  const [family, setFamily] = useState<FamilyMember[]>([]);
  const [education, setEducation] = useState<EducationRow[]>([]);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [birthdays, setBirthdays] = useState<EventPerson[]>([]);
  const [anniversaries, setAnniversaries] = useState<EventPerson[]>([]);
  const [newJoiners, setNewJoiners] = useState<EventPerson[]>([]);
  const [announcementTab, setAnnouncementTab] = useState<AnnouncementTab>('all');
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [openAnnouncement, setOpenAnnouncement] = useState<Announcement | null>(null);
  const [shiftInfo, setShiftInfo] = useState<{ shiftName: string | null; startTime: string | null; endTime: string | null }>({ shiftName: null, startTime: null, endTime: null });
  const [punchStatus, setPunchStatus] = useState<PunchStatus | null>(null);
  const [punching, setPunching] = useState(false);
  const [punchError, setPunchError] = useState<string | null>(null);
  const [displaySecs, setDisplaySecs] = useState(0);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [calView, setCalView] = useState<'week' | 'month'>('week');
  const [calOffset, setCalOffset] = useState(0);

  useEffect(() => {
    if (!empId) return;
    Promise.all([
      fetch(`/api/employees/${empId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/employees/${empId}/documents`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`/api/employees/${empId}/family`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`/api/employees/${empId}/education`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch('/api/company').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/ess/home').then((r) => (r.ok ? r.json() : { birthdays: [], anniversaries: [], newJoiners: [] })).catch(() => ({ birthdays: [], anniversaries: [], newJoiners: [] })),
      fetch(`/api/employees/${empId}/presence-summary`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/leave/balances').then((r) => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] })),
      fetch('/api/ess/home/summary').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([e, docR, famR, eduR, compR, homeR, presenceR, balR, sumR]) => {
      const professional = e?.professional ?? null;
      setEmp(e?.employee ? { ...e.employee, ...professional } : null);
      setDocs(docR || []);
      setFamily(famR || []);
      setEducation(eduR || []);
      setCompanyInfo(compR);
      setBirthdays(homeR.birthdays || []);
      setAnniversaries(homeR.anniversaries || []);
      setNewJoiners(homeR.newJoiners || []);
      setBalances(balR?.data || []);
      setSummary(sumR);
      setShiftInfo({
        shiftName: presenceR?.employee?.shift_name ?? null,
        startTime: presenceR?.shiftInfo?.startTime ?? null,
        endTime: presenceR?.shiftInfo?.endTime ?? null,
      });
      const groupId = professional?.HOLIDAY_GROUP_ID;
      if (groupId) {
        fetch(`/api/setup/holidays?groupId=${groupId}`).then((r) => (r.ok ? r.json() : [])).then((h) => setHolidays(h || [])).catch(() => {});
      }
      setLoading(false);
    });
  }, [empId]);

  useEffect(() => {
    if (!empId) return;
    fetch('/api/ess/announcements').then((r) => (r.ok ? r.json() : { data: [] })).then((d) => setAnnouncements(d.data || [])).catch(() => {});
  }, [empId]);

  // Clock in the punch card.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  function showAnnouncement(a: Announcement) {
    setOpenAnnouncement(a);
    if (a.is_read) return;
    setAnnouncements((list) => list.map((x) => (x.announcement_pkey === a.announcement_pkey ? { ...x, is_read: true } : x)));
    fetch(`/api/ess/announcements/${a.announcement_pkey}/read`, { method: 'POST' }).catch(() => {});
  }

  const refreshPunchStatus = () => {
    fetch('/api/ess/punch/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PunchStatus | null) => { if (!d) return; setPunchStatus(d); setDisplaySecs(d.elapsedSeconds); })
      .catch(() => {});
  };

  useEffect(() => {
    if (!empId) return;
    refreshPunchStatus();
  }, [empId]);

  // Live-ticking working time while checked in (legacy empdashboard.ctp's setInterval clock).
  useEffect(() => {
    if (!punchStatus?.checkedIn) return;
    const t = setInterval(() => setDisplaySecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [punchStatus?.checkedIn]);

  function doPunch(direction: 'in' | 'out', lat: number | null, lng: number | null) {
    setPunching(true);
    fetch('/api/ess/punch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction, lat, lng }) })
      .then((r) => r.json())
      .then((d) => { if (!d.success) throw new Error(); refreshPunchStatus(); })
      .catch(() => setPunchError('Punch failed. Please try again.'))
      .finally(() => setPunching(false));
  }

  // Geolocation is required before a punch is recorded — ported from legacy's checkin()/checkout().
  function handlePunch(direction: 'in' | 'out') {
    setPunchError(null);
    if (!navigator.geolocation) { setPunchError('Location services are not available in this browser.'); return; }
    setPunching(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => doPunch(direction, pos.coords.latitude, pos.coords.longitude),
      (err) => {
        setPunching(false);
        let msg = 'Could not get your location.';
        if (err.code === err.PERMISSION_DENIED) msg = 'Location permission is blocked. Please allow location access for this site and try again.';
        else if (err.code === err.POSITION_UNAVAILABLE) msg = 'Your location is unavailable right now. Please check GPS/location services and try again.';
        else if (err.code === err.TIMEOUT) msg = 'Getting your location timed out. Please try again.';
        setPunchError(msg);
      },
      { timeout: 15000 }
    );
  }

  // ── celebrations: birthdays + work anniversaries falling on each date ──
  const eventsOn = useMemo(() => {
    return (date: Date): CalEvent[] => {
      const out: CalEvent[] = [];
      for (const p of birthdays) {
        if (!p.date_of_birth) continue;
        const d = new Date(p.date_of_birth);
        if (d.getMonth() === date.getMonth() && d.getDate() === date.getDate()) out.push({ key: `b${p.emp_pkey}`, name: `${p.first_name} ${p.last_name ?? ''}`.trim(), kind: 'birthday' });
      }
      for (const p of anniversaries) {
        if (!p.joining_date) continue;
        const d = new Date(p.joining_date);
        const years = date.getFullYear() - d.getFullYear();
        if (years > 0 && d.getMonth() === date.getMonth() && d.getDate() === date.getDate()) out.push({ key: `a${p.emp_pkey}`, name: `${p.first_name} ${p.last_name ?? ''}`.trim(), kind: 'anniversary', years });
      }
      return out;
    };
  }, [birthdays, anniversaries]);

  if (loading) {
    return (
      <div style={{ height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: BRAND, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in30 = new Date(today); in30.setDate(in30.getDate() + 30);

  const expiredDocs = docs.filter((d) => d.valid_till && new Date(d.valid_till) < today);
  const expiringDocs = docs.filter((d) => d.valid_till && new Date(d.valid_till) >= today && new Date(d.valid_till) <= in30);
  const completeness = computeCompleteness(emp, family, education);
  const upcomingHolidays = holidays.filter((h) => new Date(h.HOLIDAYDATE) >= today).slice(0, 4);
  const unread = announcements.filter((a) => !a.is_read);

  const firstName = emp?.first_name != null ? String(emp.first_name) : session?.user.loginUserId ?? '';
  const empMobile = emp?.mobile_no ? String(emp.mobile_no) : null;
  const empEmail = emp?.email ? String(emp.email) : null;
  const empCode = String(emp?.emp_company_id || emp?.emp_id || '');
  const tenureYears = emp?.joining_date ? Math.floor((now.getTime() - new Date(String(emp.joining_date)).getTime()) / (365.25 * 86400000)) : null;
  const companyName = companyInfo?.business_name || '';
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const subtitle = [
    emp?.desig_name, emp?.dept_name, empCode && `#${empCode}`,
    tenureYears != null && (tenureYears >= 1 ? `${tenureYears} year${tenureYears > 1 ? 's' : ''}${companyName ? ` at ${companyName}` : ''}` : `Joined ${fmtFull(String(emp?.joining_date))}`),
  ].filter(Boolean).join(' · ');

  // Punch card: ring = how far through today's shift the clock is.
  const shiftStart = timeToMins(shiftInfo.startTime);
  let shiftEnd = timeToMins(shiftInfo.endTime);
  if (shiftStart != null && shiftEnd != null && shiftEnd <= shiftStart) shiftEnd += 24 * 60;
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const shiftPct = shiftStart != null && shiftEnd != null ? (nowMins - shiftStart) / (shiftEnd - shiftStart) : 0;
  const pastStart = shiftStart != null ? nowMins - shiftStart : null;
  const punchedOutToday = !!punchStatus && !punchStatus.checkedIn && punchStatus.lastPunch?.direction === 'out' && sameDay(new Date(punchStatus.lastPunch.time), now);
  const punchPill = punchStatus?.checkedIn
    ? { label: 'Punched in', color: GREEN, bg: 'rgba(22,163,74,0.12)' }
    : punchedOutToday ? { label: 'Punched out', color: BRAND, bg: BRAND_DIM } : { label: 'Not punched in', color: AMBER, bg: 'rgba(217,119,6,0.12)' };

  // Stat cards.
  const leaveLeft = balances.reduce((s, b) => s + (Number(b.balance) > 0 ? Number(b.balance) : 0), 0);
  const week = summary?.week;
  const month = summary?.month;
  const presentPct = month && month.workingDays ? month.present / Math.max(1, month.workingDays - month.onLeave) : 0;
  const waiting = [
    ...(expiredDocs.length ? [`${expiredDocs.length} expired document${expiredDocs.length > 1 ? 's' : ''}`] : []),
    ...(expiringDocs.length ? [`${expiringDocs.length} document${expiringDocs.length > 1 ? 's' : ''} expiring`] : []),
    ...completeness.missing.filter((m) => m.payroll).map((m) => m.label),
    ...(unread.length ? [`${unread.length} unread update${unread.length > 1 ? 's' : ''}`] : []),
  ];

  // Celebrations calendar.
  // As in the design, the week view starts with today; the arrows move it 7 days at a time.
  const calStart = new Date(today); calStart.setDate(today.getDate() + calOffset * 7);
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(calStart); d.setDate(calStart.getDate() + i); return d; });
  const monthBase = new Date(today.getFullYear(), today.getMonth() + calOffset, 1);
  const monthCells: (Date | null)[] = [
    ...Array.from({ length: monthBase.getDay() }, () => null),
    ...Array.from({ length: new Date(monthBase.getFullYear(), monthBase.getMonth() + 1, 0).getDate() }, (_, i) => new Date(monthBase.getFullYear(), monthBase.getMonth(), i + 1)),
  ];
  while (monthCells.length % 7) monthCells.push(null);
  const weekEventCount = weekDays.reduce((s, d) => s + eventsOn(d).length, 0);
  const nextWeekFirst = (() => {
    for (let i = 7; i < 14; i++) {
      const d = new Date(calStart); d.setDate(calStart.getDate() + i);
      const ev = eventsOn(d)[0];
      if (ev) return { d, ev };
    }
    return null;
  })();
  const rangeLabel = calView === 'week'
    ? `${weekDays[0].getDate()}${weekDays[0].getMonth() !== weekDays[6].getMonth() ? ` ${weekDays[0].toLocaleString('en-GB', { month: 'short' })}` : ''} – ${weekDays[6].getDate()} ${weekDays[6].toLocaleString('en-GB', { month: 'long' })}`
    : monthBase.toLocaleString('en-GB', { month: 'long', year: 'numeric' });

  const eventChip = (e: CalEvent, compact = false) => (
    <div key={e.key} title={e.name} style={{ display: 'flex', alignItems: 'center', gap: compact ? 4 : 8, padding: compact ? '4px 6px' : 8, borderRadius: 11, background: 'var(--bg-card)', border: '1px solid var(--border)', minWidth: 0 }}>
      {!compact && <Avatar name={e.name} size={30} bg={e.kind === 'birthday' ? 'rgba(217,119,6,0.12)' : 'rgba(124,58,237,0.12)'} fg={e.kind === 'birthday' ? BDAY : ANNIV} />}
      {compact && <span style={{ fontSize: 12, lineHeight: 1 }}>{e.kind === 'birthday' ? '🎂' : '🏅'}</span>}
      <div className={compact ? 'home-chip-text' : undefined} style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: compact ? 11 : 12, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</span>
        <span style={{ fontSize: 11, color: e.kind === 'birthday' ? BDAY : ANNIV, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {compact ? (e.kind === 'birthday' ? 'Birthday' : `${e.years} yr`) : e.kind === 'birthday' ? '🎂 Birthday' : `🏅 ${e.years} year${(e.years ?? 0) > 1 ? 's' : ''}`}
        </span>
      </div>
    </div>
  );

  const visibleAnnouncements = announcements.filter((a) => matchesTab(a, announcementTab));
  const lastAnnouncement = announcements.map((a) => a.publish_from).sort().pop();

  return (
    <div style={{ background: 'var(--bg-page)', minHeight: '100%' }}>
      {/* ess-legacy.css resets margin/padding on every element, so spacing below is inline. */}
      <style>{`
        .home-grid-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
        .home-grid-main { display: grid; grid-template-columns: minmax(0, 1fr) 378px; gap: 18px; align-items: start; }
        .home-grid-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; }
        .home-grid-month { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
        .home-hero { display: flex; align-items: center; gap: 30px; flex-wrap: wrap; }
        .home-punch { flex: 0 0 auto; width: auto; margin-left: auto; }
        @media (max-width: 1280px) { .home-grid-week { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
        @media (max-width: 1180px) { .home-grid-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } .home-grid-main { grid-template-columns: minmax(0, 1fr); } }
        @media (max-width: 860px) { .home-grid-week { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (max-width: 640px) {
          .home-grid-stats { grid-template-columns: minmax(0, 1fr); }
          .home-grid-week { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .home-grid-month { gap: 3px; }
          .home-month-cell { min-height: 54px !important; padding: 4px !important; border-radius: 8px !important; }
          .home-chip-text { display: none !important; }
          .home-wrap { padding: 16px 14px 32px !important; gap: 14px !important; }
          .home-hero { padding: 20px !important; gap: 16px !important; border-radius: 20px !important; }
          .home-hero h1 { font-size: 24px !important; }
          .home-avatar { width: 68px !important; height: 68px !important; border-radius: 20px !important; font-size: 26px !important; }
          .home-punch { margin-left: 0; max-width: 100%; padding: 14px !important; gap: 12px !important; }
          .home-card-pad { padding: 16px !important; }
          .home-cal-head { gap: 8px !important; }
        }
        @media (max-width: 400px) { .home-grid-week { grid-template-columns: minmax(0, 1fr); } .home-week-cell { min-height: 0 !important; } }
        .home-tab:hover { border-color: ${BRAND} !important; }
        .home-link:hover { text-decoration: underline !important; }
      `}</style>

      <div className="home-wrap" style={{ padding: '24px 28px 40px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* ── Hero ─────────────────────────────────────────────────────────────────────── */}
        <section className="home-hero" style={{ position: 'relative', background: HERO_GRADIENT, borderRadius: 26, padding: '16px 32px', color: '#fff', overflow: 'hidden', boxShadow: '0 18px 40px -22px rgba(7,21,32,0.75)' }}>
          <svg width="520" height="520" viewBox="0 0 520 520" fill="none" style={{ position: 'absolute', right: -110, top: -150, opacity: 0.35, pointerEvents: 'none' }} aria-hidden="true">
            <circle cx="260" cy="260" r="120" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
            <circle cx="260" cy="260" r="180" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
            <circle cx="260" cy="260" r="240" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
          </svg>
          <span style={{ position: 'absolute', left: 340, bottom: -70, width: 220, height: 220, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} aria-hidden="true" />

          {/* avatar */}
          <div className="home-avatar" style={{ position: 'relative', zIndex: 1, width: 96, height: 96, flexShrink: 0, borderRadius: 28, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, fontWeight: 800 }}>
            {photoUrl(emp?.profile_pic) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl(emp?.profile_pic)!} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 28 }} />
            ) : getInitials(emp?.first_name as string, emp?.last_name as string)}
            <span style={{ position: 'absolute', right: -4, bottom: -4, width: 22, height: 22, borderRadius: '50%', background: '#10b981', border: '3px solid #0d2c40' }} />
          </div>

          {/* identity */}
          <div style={{ position: 'relative', zIndex: 1, flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.015em', color: '#fff', lineHeight: 1.15, overflowWrap: 'anywhere' }}>{greeting}, {firstName}</h1>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999, background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.35)', fontSize: 12, fontWeight: 700, color: '#6ee7b7' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34d399' }} />Active
              </span>
            </div>
            {subtitle && <p style={{ fontSize: 15, lineHeight: 1.45, color: 'rgba(255,255,255,0.72)', overflowWrap: 'anywhere' }}>{subtitle}</p>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginTop: 2 }}>
              {shiftInfo.startTime && shiftInfo.endTime && (
                <span style={heroChip}><span style={{ color: '#fbbf24' }}>🕘</span>{shiftInfo.shiftName ? `${shiftInfo.shiftName} · ` : 'Shift '}{fmtTime(shiftInfo.startTime)} – {fmtTime(shiftInfo.endTime)}</span>
              )}
              {empEmail && <a href={`mailto:${empEmail}`} style={heroChip}><span style={{ color: '#93c5fd' }}>✉</span>{empEmail}</a>}
              {empMobile && <a href={`tel:${empMobile}`} style={heroChip}><span style={{ color: '#7dd3fc' }}>✆</span>{empMobile}</a>}
            </div>
          </div>

          {/* punch card */}
          {punchStatus && (
            <div className="home-punch" style={{ position: 'relative', zIndex: 1, minWidth: 0, background: 'var(--bg-card)', borderRadius: 16, padding: '14px 16px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 16px 34px -20px rgba(7,21,32,0.6)' }}>
              <Ring size={76} stroke={7} pct={shiftPct} color={AMBER}>
                <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em' }}>{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).split(' ')[0]}</span>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', ...muted }}>{now.getHours() >= 12 ? 'PM' : 'AM'}</span>
              </Ring>
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap', color: punchPill.color, background: punchPill.bg, padding: '3px 9px', borderRadius: 999, alignSelf: 'flex-start' }}>{punchPill.label}</span>
                <button type="button" onClick={() => handlePunch(punchStatus.checkedIn ? 'out' : 'in')} disabled={punching}
                  style={{ minWidth: 140, padding: '0 20px', height: 38, border: 'none', borderRadius: 11, background: punchStatus.checkedIn ? RED : BRAND, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: punching ? 'not-allowed' : 'pointer', opacity: punching ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, boxShadow: '0 8px 18px -10px rgba(30,81,110,0.9)' }}>
                  {punching ? 'Please wait…' : punchStatus.checkedIn ? '⇥ Punch out' : '⇤ Punch in'}
                </button>
                <p style={{ fontSize: 11, lineHeight: 1.35, ...muted }}>
                  {punchStatus.checkedIn
                    ? <>Working time <b style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{fmtElapsed(displaySecs)}</b></>
                    : punchStatus.lastPunch && punchedOutToday
                      ? `Last punch ${new Date(punchStatus.lastPunch.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · OUT`
                      : pastStart != null && pastStart > 0 && shiftPct < 1
                        ? `${fmtHm(pastStart)} past shift start`
                        : pastStart != null && pastStart < 0 ? `Shift starts in ${fmtHm(-pastStart)}` : 'Outside shift hours'}
                </p>
                {punchError && <p style={{ fontSize: 11, color: RED }}>{punchError}</p>}
              </div>
            </div>
          )}
        </section>

        {/* ── Stats ─────────────────────────────────────────────────────────────────────── */}
        <section className="home-grid-stats">
          <div className="home-card-pad" style={{ ...card, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <IconBox bg={BRAND_DIM}>🕘</IconBox>
              <span style={{ fontSize: 12, fontWeight: 700, ...muted }}>Hours this week</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>{fmtHm(week?.workedMins ?? 0)}</span>
                <span style={{ fontSize: 12, ...muted }}>of {fmtHm(week?.targetMins ?? 0)} target</span>
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', gap: 4, height: 36 }}>
                {(week?.days ?? []).filter((d) => d.working).map((d) => {
                  const day = week!.targetMins / Math.max(1, week!.days.filter((x) => x.working).length);
                  const h = d.future ? 12 : Math.max(4, Math.min(36, (d.minutes / Math.max(1, day)) * 32));
                  return <span key={d.date} title={`${d.date}: ${fmtHm(d.minutes)}`} style={{ width: 8, height: h, borderRadius: 3, background: d.future ? 'var(--border)' : BRAND }} />;
                })}
              </div>
            </div>
          </div>

          <div className="home-card-pad" style={{ ...card, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <IconBox bg="rgba(39,114,160,0.12)">📅</IconBox>
              <span style={{ fontSize: 12, fontWeight: 700, ...muted }}>Leave balance</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <span style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>{Number.isInteger(leaveLeft) ? leaveLeft : leaveLeft.toFixed(1)}</span>
              <span style={{ fontSize: 13, ...muted }}>days left</span>
            </div>
            <Link href="/ess/requests?tab=leave" className="home-link" style={linkStyle}>Apply for leave →</Link>
          </div>

          <div className="home-card-pad" style={{ ...card, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <Ring size={62} stroke={7} pct={presentPct} color={GREEN}>
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{Math.round(presentPct * 100)}%</span>
            </Ring>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 700, ...muted }}>Present this month</span>
              <span style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>{month?.present ?? 0} of {Math.max(0, (month?.workingDays ?? 0) - (month?.onLeave ?? 0))} days</span>
              <span style={{ fontSize: 12, ...muted }}>{month?.late ?? 0} late · {month?.absent ?? 0} absent{month?.onLeave ? ` · ${month.onLeave} leave` : ''}</span>
            </div>
          </div>

          <div className="home-card-pad" style={{ ...card, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, ...(waiting.length ? { background: 'rgba(220,38,38,0.05)', borderColor: 'rgba(220,38,38,0.22)' } : {}) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <IconBox bg={waiting.length ? 'rgba(220,38,38,0.12)' : 'rgba(22,163,74,0.12)'}>{waiting.length ? '❗' : '✅'}</IconBox>
              <span style={{ fontSize: 12, fontWeight: 700, color: waiting.length ? '#b91c1c' : 'var(--text-muted)' }}>Waiting on you</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <span style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.02em', color: waiting.length ? RED : 'var(--text-primary)' }}>{waiting.length}</span>
              <span style={{ fontSize: 13, color: waiting.length ? '#b91c1c' : 'var(--text-muted)' }}>open item{waiting.length === 1 ? '' : 's'}</span>
            </div>
            {waiting.length ? (
              <Link href="/ess/about" className="home-link" style={{ ...linkStyle, color: RED, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={waiting.join(', ')}>{waiting.join(', ')} →</Link>
            ) : <span style={{ fontSize: 13, ...muted }}>You&apos;re all caught up</span>}
          </div>
        </section>

        {/* ── Feed + rail ───────────────────────────────────────────────────────────────── */}
        <section className="home-grid-main">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
            <div className="home-card-pad" style={{ ...card, borderRadius: 20, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: visibleAnnouncements.length ? undefined : 320 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h2 style={h2}>Company updates</h2>
                {unread.length > 0 && <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: RED, padding: '2px 8px', borderRadius: 20 }}>{unread.length} new</span>}
                <div style={{ flex: '1 1 280px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {ANNOUNCEMENT_TABS.map((t) => {
                    const active = announcementTab === t;
                    const n = announcements.filter((a) => matchesTab(a, t)).length;
                    return (
                      <button key={t} className="home-tab" onClick={() => setAnnouncementTab(t)}
                        style={{ padding: '6px 13px', borderRadius: 999, border: `1px solid ${active ? BRAND : 'var(--border)'}`, background: active ? BRAND : 'var(--bg-card)', color: active ? '#fff' : 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        {ANNOUNCEMENT_TAB_LABEL[t]}{t !== 'all' && n > 0 ? ` ${n}` : ''}
                      </button>
                    );
                  })}
                </div>
              </div>

              {visibleAnnouncements.length === 0 ? (
                <div style={{ flex: 1, borderRadius: 16, background: 'var(--bg-page)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22, padding: 22, flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative', width: 86, height: 86, flexShrink: 0, borderRadius: '50%', background: BRAND_DIM, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ width: 58, height: 58, borderRadius: '50%', background: BRAND_DIM, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>📢</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 420 }}>
                    <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>
                      {announcementTab === 'all' ? 'All quiet on the notice board' : `No ${ANNOUNCEMENT_TAB_LABEL[announcementTab].toLowerCase()} updates`}
                    </span>
                    <span style={{ fontSize: 13, lineHeight: 1.5, ...muted }}>
                      HR posts policy changes, holidays and town halls here.{lastAnnouncement ? ` Latest update ${fmtFull(lastAnnouncement)}.` : ' Nothing has been posted yet.'}
                    </span>
                    {announcementTab !== 'all' && announcements.length > 0 && (
                      <button onClick={() => setAnnouncementTab('all')} className="home-link" style={{ ...linkStyle, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', marginTop: 6 }}>Browse all updates →</button>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
                  {visibleAnnouncements.map((a) => {
                    const st = CATEGORY_STYLE[a.category];
                    return (
                      <button key={a.announcement_pkey} onClick={() => showAnnouncement(a)}
                        style={{ textAlign: 'left', cursor: 'pointer', width: '100%', background: a.category === 'Emergency' && !a.is_read ? st.bg : 'var(--bg-card)', border: `1px solid ${a.category === 'Emergency' ? st.border : 'var(--border)'}`, borderLeft: `4px solid ${st.color}`, borderRadius: 14, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: st.bg, border: `1px solid ${st.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{st.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {a.is_pinned && <span style={{ fontSize: 11 }}>📌</span>}
                            <span style={{ fontSize: 13.5, fontWeight: a.is_read ? 600 : 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{a.title}</span>
                            {!a.is_read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: st.color, flexShrink: 0 }} />}
                          </div>
                          <div style={{ fontSize: 12, marginTop: 3, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', ...muted }}>{a.message}</div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                            <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.4px', color: st.color }}>{a.category}</span>
                            <span style={{ fontSize: 11, ...muted }}>{fmtFull(a.publish_from)}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="home-card-pad" style={{ ...card, borderRadius: 20, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ width: 46, height: 46, borderRadius: 14, background: BRAND_DIM, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 20 }}>💬</span>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>No leadership message yet</span>
                <span style={{ fontSize: 13, ...muted }}>Notes from leadership will appear here when they&apos;re posted.</span>
              </div>
            </div>
          </div>

          {/* rail */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
            <div className="home-card-pad" style={{ ...card, borderRadius: 20, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Ring size={54} stroke={7} pct={completeness.score / 100} color={completeness.score >= 80 ? GREEN : completeness.score >= 50 ? AMBER : RED}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: completeness.score >= 80 ? GREEN : completeness.score >= 50 ? AMBER : RED }}>{completeness.score}%</span>
                </Ring>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <h2 style={h2}>{completeness.missing.length ? 'Finish your profile' : 'Profile complete'}</h2>
                  <span style={{ fontSize: 13, ...muted }}>
                    {completeness.missing.length
                      ? `${completeness.missing.length} of ${completeness.total} missing${completeness.missing.some((m) => m.payroll) ? ` · ${completeness.missing.filter((m) => m.payroll).length} needed for payroll` : ''}`
                      : 'All profile details are filled in.'}
                  </span>
                </div>
              </div>
              {completeness.missing.length > 0 && (
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
                  {completeness.missing.slice(0, 6).map((m) => (
                    <li key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                      <span style={{ width: 20, height: 20, borderRadius: '50%', border: '1.5px solid var(--border)', flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{m.label}</span>
                      {m.payroll && <span style={{ fontSize: 11, fontWeight: 800, color: AMBER, background: 'rgba(217,119,6,0.12)', padding: '3px 9px', borderRadius: 999 }}>Payroll</span>}
                      <Link href="/ess/about" className="home-link" style={linkStyle}>Add</Link>
                    </li>
                  ))}
                  {completeness.missing.length > 6 && (
                    <li style={{ paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                      <Link href="/ess/about" className="home-link" style={linkStyle}>+{completeness.missing.length - 6} more →</Link>
                    </li>
                  )}
                </ul>
              )}
            </div>

            <div className="home-card-pad" style={{ ...card, borderRadius: 20, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <h2 style={h2}>My team today</h2>
                {(summary?.team.length ?? 0) > 0 && <Link href="/ess/team" className="home-link" style={linkStyle}>All {summary!.team.length}</Link>}
              </div>
              {(summary?.team ?? []).length === 0 ? (
                <span style={{ fontSize: 13, ...muted }}>No team members to show.</span>
              ) : summary!.team.slice(0, 5).map((t) => {
                const st = TEAM_STATUS[t.status];
                return (
                  <div key={t.emp_pkey} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <Avatar name={t.name} pic={t.profile_pic} />
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                      <span style={{ fontSize: 11, ...muted }}>{t.emp_code}</span>
                    </div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: st.color, background: st.bg, padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.color }} />{st.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {upcomingHolidays.length > 0 && (
              <div className="home-card-pad" style={{ ...card, borderRadius: 20, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <h2 style={h2}>Upcoming holidays</h2>
                {upcomingHolidays.map((h) => {
                  const d = daysUntil(h.HOLIDAYDATE);
                  const soon = d <= 7;
                  return (
                    <div key={h.HOLIDAYID} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 40, textAlign: 'center', background: soon ? 'rgba(217,119,6,0.12)' : 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 9, padding: '3px 0', flexShrink: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.2, color: soon ? AMBER : 'var(--text-primary)' }}>{new Date(h.HOLIDAYDATE).toLocaleDateString('en-IN', { day: '2-digit' })}</div>
                        <div style={{ fontSize: 9, textTransform: 'uppercase', fontWeight: 700, color: soon ? AMBER : 'var(--text-muted)' }}>{new Date(h.HOLIDAYDATE).toLocaleDateString('en-IN', { month: 'short' })}</div>
                      </div>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.HOLIDAYNAME}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: soon ? AMBER : 'var(--text-muted)' }}>{d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `${d}d`}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {newJoiners.length > 0 && (
              <div className="home-card-pad" style={{ ...card, borderRadius: 20, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <h2 style={h2}>New to the team</h2>
                  <span style={{ fontSize: 12, fontWeight: 700, color: GREEN }}>{newJoiners.length} this month</span>
                </div>
                {newJoiners.slice(0, 4).map((p) => (
                  <div key={p.emp_pkey} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar name={`${p.first_name} ${p.last_name ?? ''}`} size={32} bg="rgba(22,163,74,0.12)" fg={GREEN} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.first_name} {p.last_name}</div>
                      <div style={{ fontSize: 11, ...muted }}>{p.desig_name}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: GREEN }}>{p.joining_date ? new Date(p.joining_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── Celebrations & people ────────────────────────────────────────────────────── */}
        <section className="home-card-pad" style={{ ...card, borderRadius: 20, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="home-cal-head" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={h2}>Celebrations &amp; people</h2>
            {calView === 'week' && <span style={{ fontSize: 12, fontWeight: 800, color: AMBER, background: 'rgba(217,119,6,0.12)', padding: '3px 10px', borderRadius: 999 }}>{weekEventCount} {calOffset === 0 ? 'this week' : 'in view'}</span>}
            <span style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button type="button" aria-label="Previous" onClick={() => setCalOffset((o) => o - 1)} style={navBtn}>‹</button>
              <span style={{ minWidth: 140, textAlign: 'center', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{rangeLabel}</span>
              <button type="button" aria-label="Next" onClick={() => setCalOffset((o) => o + 1)} style={navBtn}>›</button>
            </div>
            <div style={{ display: 'flex', padding: 3, borderRadius: 10, background: 'var(--bg-page)', border: '1px solid var(--border)', gap: 2 }}>
              {(['week', 'month'] as const).map((v) => (
                <button key={v} type="button" onClick={() => { setCalView(v); setCalOffset(0); }}
                  style={{ padding: '6px 14px', border: 'none', borderRadius: 8, background: calView === v ? 'var(--bg-card)' : 'transparent', color: calView === v ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: calView === v ? '0 1px 2px rgba(20,23,26,0.08)' : 'none', textTransform: 'capitalize' }}>
                  {v}
                </button>
              ))}
            </div>
          </div>

          {calView === 'week' ? (
            <div className="home-grid-week">
              {weekDays.map((d, i) => {
                const evs = eventsOn(d);
                const isToday = sameDay(d, today);
                const isTomorrow = daysUntil(d.toISOString()) === 1;
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <div key={i} className="home-week-cell" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 16, minHeight: 186, minWidth: 0,
                    background: isToday ? HERO_GRADIENT : isTomorrow ? 'rgba(217,119,6,0.07)' : 'var(--bg-page)',
                    border: isToday ? 'none' : `1px solid ${isTomorrow ? 'rgba(217,119,6,0.3)' : 'var(--border)'}` }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap', rowGap: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: isToday ? 'rgba(255,255,255,0.7)' : weekend ? 'var(--text-muted)' : 'var(--text-muted)' }}>{d.toLocaleString('en-GB', { weekday: 'short' })}</span>
                      <span style={{ fontSize: 20, fontWeight: 800, color: isToday ? '#fff' : weekend ? 'var(--text-muted)' : 'var(--text-primary)' }}>{d.getDate()}</span>
                      {isToday ? <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: BRAND, background: '#fff', padding: '3px 7px', borderRadius: 999 }}>Today</span>
                        : isTomorrow ? <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, color: '#fff', background: AMBER, padding: '3px 7px', borderRadius: 999 }}>Tmrw</span>
                        : evs.length > 1 ? <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, background: 'var(--border)', padding: '3px 7px', borderRadius: 999, ...muted }}>{evs.length}</span> : null}
                    </div>
                    {evs.length === 0 ? (
                      <span style={{ fontSize: 12, lineHeight: 1.45, color: isToday ? 'rgba(255,255,255,0.75)' : 'var(--text-muted)' }}>
                        {isToday ? 'Nothing to celebrate today — a good day to send a late note.' : weekend ? 'Weekend' : ''}
                      </span>
                    ) : evs.map((e) => eventChip(e))}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="home-grid-month">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => <div key={w} style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'center', ...muted }}>{w}</div>)}
              {monthCells.map((d, i) => {
                const evs = d ? eventsOn(d) : [];
                const isToday = d ? sameDay(d, today) : false;
                return (
                  <div key={i} className="home-month-cell" style={{ minHeight: 84, padding: 6, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
                    background: !d ? 'transparent' : isToday ? HERO_GRADIENT : 'var(--bg-page)', border: d && !isToday ? '1px solid var(--border)' : 'none' }}>
                    {d && <span style={{ fontSize: 12, fontWeight: 800, color: isToday ? '#fff' : 'var(--text-primary)' }}>{d.getDate()}</span>}
                    {evs.slice(0, 2).map((e) => eventChip(e, true))}
                    {evs.length > 2 && <span style={{ fontSize: 10, fontWeight: 700, color: isToday ? '#fff' : 'var(--text-muted)' }}>+{evs.length - 2} more</span>}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingTop: 12, borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: BDAY }}>🎂 <span style={muted}>Birthday</span></span>
            <span style={{ fontSize: 12, color: ANNIV }}>🏅 <span style={muted}>Work anniversary</span></span>
            {calView === 'week' && nextWeekFirst && (
              <span style={{ fontSize: 12, ...muted }}>
                Next week · {nextWeekFirst.ev.name}, {nextWeekFirst.ev.kind === 'birthday' ? 'birthday' : `${nextWeekFirst.ev.years}-year anniversary`} on {nextWeekFirst.d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
              </span>
            )}
            <span style={{ flex: 1 }} />
            {calView === 'week' && (
              <button type="button" onClick={() => { setCalView('month'); setCalOffset(0); }} className="home-link" style={{ ...linkStyle, background: 'none', border: 'none', cursor: 'pointer' }}>Open full calendar →</button>
            )}
          </div>
        </section>
      </div>

      {openAnnouncement && (() => {
        const st = CATEGORY_STYLE[openAnnouncement.category];
        return (
          <div onClick={() => setOpenAnnouncement(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.35)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ width: '100%', maxWidth: 520, maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', borderRadius: 18, overflow: 'hidden', boxShadow: '0 25px 70px -15px rgba(0,0,0,0.35)', borderTop: `5px solid ${st.color}` }}>
              <div style={{ padding: '18px 20px 14px', display: 'flex', gap: 12, alignItems: 'flex-start', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: st.bg, border: `1px solid ${st.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{st.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3 }}>{openAnnouncement.title}</div>
                  <div style={{ fontSize: 11, marginTop: 4, ...muted }}>
                    <span style={{ fontWeight: 800, color: st.color, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{openAnnouncement.category}</span>
                    {openAnnouncement.is_pinned && ' · 📌 Pinned'} · {fmtFull(openAnnouncement.publish_from)}
                    {openAnnouncement.expires_on && ` · until ${fmtFull(openAnnouncement.expires_on)}`}
                  </div>
                </div>
                <button onClick={() => setOpenAnnouncement(null)} aria-label="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: 'var(--text-muted)', padding: 4 }}>✕</button>
              </div>
              <div style={{ padding: '16px 20px 22px', overflowY: 'auto', fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {openAnnouncement.message}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const heroChip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 13px', borderRadius: 10, maxWidth: '100%', minWidth: 0, overflowWrap: 'anywhere',
  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)', fontSize: 13, color: 'rgba(255,255,255,0.88)', textDecoration: 'none',
};
const navBtn: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16,
};
