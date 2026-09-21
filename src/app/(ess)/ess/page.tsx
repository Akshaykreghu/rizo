'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Phone, Mail, Clock, MapPin, LogIn, LogOut } from 'lucide-react';

// Port of New Rizo's pages/ESS/ESSDashboard.jsx, a `1fr 1fr 300px` 3-panel top row (Leadership
// Message | Company Updates | Profile sidebar). rizo-revamp has no announcements/leadership-
// message feature yet (no table, no admin UI to author one), so Panels 1 & 2 always render New
// Rizo's own empty-state fallback rather than fabricated data — same as how New Rizo itself
// renders them for a company with nothing posted yet. Dropping the panels entirely (the previous
// version of this file) left the grid as a single narrow column with a large empty void beside
// it, which is the actual bug being fixed here — not a missing feature, a wrong layout.
const ANNOUNCEMENT_TABS = ['all', 'urgent', 'important', 'pinned'] as const;

type Employee = Record<string, string | number | null | undefined>;
interface CompanyInfo { business_name?: string; business_nature?: string; address?: string; city?: string; state?: string; pincode?: string; phone?: string; email?: string; logo?: string }
// Some legacy-imported company rows have literal "0" placeholders instead of empty strings.
const realVal = (v?: string | null) => (v && v !== '0' ? v : null);
interface Holiday { HOLIDAYID: number; HOLIDAYNAME: string; HOLIDAYDATE: string }
interface FamilyMember { is_emergency_contact?: string | null; emergency_contact?: string | null }
interface EducationRow { education_pkey: number }
interface PersonalDoc { document_type: string; valid_till: string | null }
interface EventPerson { emp_pkey: number; first_name: string; last_name: string | null; desig_name: string | null; dept_name: string | null; date_of_birth?: string; joining_date?: string }

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
function fmtTime(t?: string | null) {
  if (!t) return null;
  const parts = String(t).split(':');
  const h = Number(parts[0]);
  if (Number.isNaN(h)) return null;
  const mn = parts[1] || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${mn} ${ampm}`;
}
function fmtElapsed(totalSecs: number) {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = Math.floor(totalSecs % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function tenureStr(from: string) {
  const joined = new Date(from);
  const now = new Date();
  const months = (now.getFullYear() - joined.getFullYear()) * 12 + (now.getMonth() - joined.getMonth());
  const yrs = Math.floor(months / 12), mos = months % 12;
  return yrs > 0 ? `${yrs}y ${mos}m` : `${mos}m`;
}
const isYes = (v: unknown) => String(v ?? '').toUpperCase() === 'Y';

function computeCompleteness(emp: Employee | null, family: FamilyMember[], education: EducationRow[]) {
  if (!emp) return { score: 0, missing: [] as string[] };
  const checks = [
    { label: 'Date of birth', done: !!emp.date_of_birth },
    { label: 'Gender', done: !!emp.classification },
    { label: 'Mobile number', done: !!emp.mobile_no },
    { label: 'Blood group', done: !!emp.blood },
    { label: 'Address', done: !!emp.address },
    { label: 'PAN number', done: !!emp.pan_no },
    { label: 'Aadhaar / ID card', done: !!emp.id_card },
    { label: 'Bank account', done: !!emp.account_no },
    { label: 'Emergency contact', done: family.some((f) => isYes(f.is_emergency_contact) || isYes(f.emergency_contact)) },
    { label: 'Education record', done: education.length > 0 },
  ];
  const done = checks.filter((c) => c.done).length;
  return { score: Math.round((done / checks.length) * 100), missing: checks.filter((c) => !c.done).map((c) => c.label) };
}

interface PunchStatus {
  checkedIn: boolean;
  elapsedSeconds: number;
  lastPunch: { time: string; direction: 'in' | 'out' } | null;
}
interface TimedEvent extends EventPerson {
  kind: 'birthday' | 'anniversary';
  color: string;
  thisYearDate: Date;
  years?: number;
}

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
  const [announcementTab, setAnnouncementTab] = useState<(typeof ANNOUNCEMENT_TABS)[number]>('all');
  const [shiftInfo, setShiftInfo] = useState<{ shiftName: string | null; startTime: string | null; endTime: string | null }>({ shiftName: null, startTime: null, endTime: null });
  const [punchStatus, setPunchStatus] = useState<PunchStatus | null>(null);
  const [punching, setPunching] = useState(false);
  const [punchError, setPunchError] = useState<string | null>(null);
  const [displaySecs, setDisplaySecs] = useState(0);

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
    ]).then(([e, docR, famR, eduR, compR, homeR, presenceR]) => {
      const professional = e?.professional ?? null;
      setEmp(e?.employee ? { ...e.employee, ...professional } : null);
      setDocs(docR || []);
      setFamily(famR || []);
      setEducation(eduR || []);
      setCompanyInfo(compR);
      setBirthdays(homeR.birthdays || []);
      setAnniversaries(homeR.anniversaries || []);
      setNewJoiners(homeR.newJoiners || []);
      setShiftInfo({
        shiftName: presenceR?.employee?.shift_name ?? null,
        startTime: presenceR?.shiftInfo?.startTime ?? null,
        endTime: presenceR?.shiftInfo?.endTime ?? null,
      });

      const groupId = professional?.HOLIDAY_GROUP_ID;
      if (groupId) {
        fetch(`/api/setup/holidays?groupId=${groupId}`)
          .then((r) => (r.ok ? r.json() : []))
          .then((h) => setHolidays(h || []))
          .catch(() => {});
      }
      setLoading(false);
    });
  }, [empId]);

  const refreshPunchStatus = () => {
    fetch('/api/ess/punch/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PunchStatus | null) => {
        if (!d) return;
        setPunchStatus(d);
        setDisplaySecs(d.elapsedSeconds);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!empId) return;
    refreshPunchStatus();
  }, [empId]);

  // Live-ticking "working time" clock while checked in — content ported from legacy's
  // empdashboard.ctp clock (setInterval incrementing a displayed HH:MM:SS), not re-fetched from
  // the server every second.
  useEffect(() => {
    if (!punchStatus?.checkedIn) return;
    const t = setInterval(() => setDisplaySecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [punchStatus?.checkedIn]);

  function doPunch(direction: 'in' | 'out', lat: number | null, lng: number | null) {
    setPunching(true);
    fetch('/api/ess/punch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, lat, lng }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) throw new Error();
        refreshPunchStatus();
      })
      .catch(() => setPunchError('Punch failed. Please try again.'))
      .finally(() => setPunching(false));
  }

  // Geolocation is required before a punch is recorded — ported from legacy's checkin()/checkout()
  // (Controller/DashboardController.php's checkpunch() logs it for the audit trail), including the
  // same specific permission/unavailable/timeout messages instead of a generic failure.
  function handlePunch(direction: 'in' | 'out') {
    setPunchError(null);
    if (!navigator.geolocation) {
      setPunchError('Location services are not available in this browser.');
      return;
    }
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

  if (loading) {
    return (
      <div style={{ height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: '#1E516E', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
  const in30 = new Date(today); in30.setDate(in30.getDate() + 30);
  const thisYear = today.getFullYear();

  const allEvents: TimedEvent[] = [
    ...birthdays
      .filter((p) => p.date_of_birth)
      .map((p) => {
        const d = new Date(p.date_of_birth!);
        return { ...p, kind: 'birthday' as const, color: '#d97706', thisYearDate: new Date(thisYear, d.getMonth(), d.getDate()) };
      }),
    ...anniversaries
      .filter((p) => p.joining_date)
      .map((p) => {
        const d = new Date(p.joining_date!);
        return { ...p, kind: 'anniversary' as const, color: '#7c3aed', thisYearDate: new Date(thisYear, d.getMonth(), d.getDate()), years: thisYear - d.getFullYear() };
      }),
  ]
    .filter((e) => e.thisYearDate >= today && e.thisYearDate <= in7)
    .sort((a, b) => a.thisYearDate.getTime() - b.thisYearDate.getTime());

  const todayEvents = allEvents.filter((e) => e.thisYearDate.getTime() === today.getTime());
  const upcomingEvents = allEvents.filter((e) => e.thisYearDate.getTime() > today.getTime());

  const expiredDocs = docs.filter((d) => d.valid_till && new Date(d.valid_till) < today);
  const expiringDocs = docs.filter((d) => d.valid_till && new Date(d.valid_till) >= today && new Date(d.valid_till) <= in30);

  const completeness = computeCompleteness(emp, family, education);
  const upcomingHolidays = holidays.filter((h) => new Date(h.HOLIDAYDATE) >= today).slice(0, 5);

  const addressLine = companyInfo
    ? [realVal(companyInfo.address), realVal(companyInfo.city), realVal(companyInfo.state), realVal(companyInfo.pincode)].filter(Boolean).join(', ')
    : '';
  const phone = realVal(companyInfo?.phone);
  const email = realVal(companyInfo?.email);
  const businessNature = realVal(companyInfo?.business_nature);
  const empFirstName = emp?.first_name != null ? String(emp.first_name) : null;
  const empMobile = emp?.mobile_no != null ? String(emp.mobile_no) : null;
  const empEmail = emp?.email != null ? String(emp.email) : null;

  return (
    <div style={{ background: 'var(--bg-page)', minHeight: '100%' }}>
      {/* Company hero banner
          NOTE: ess-legacy.css has `.ess-legacy * { margin: 0; padding: 0; }` — a universal reset
          with the exact same specificity as any single Tailwind utility class, and it loads after
          the Tailwind bundle, so it wins every padding/margin utility class below (they'd silently
          resolve to 0, though colors/flex/gap/border-radius are untouched since the reset doesn't
          set those). Padding and margin are therefore set inline here instead, which always wins
          regardless of stylesheet order — Tailwind classes are kept for everything the reset
          doesn't reach. */}
      <div style={{ background: 'linear-gradient(135deg, #071520 0%, #0d2c40 30%, #1E516E 65%, #2772a0 100%)', position: 'relative', overflow: 'hidden', padding: 0 }}>
        {/* New Rizo's own decorative blobs (ESSDashboard.jsx) — direct children of the full-bleed
            gradient div (not nested inside a padded header/wrapper), so they sit behind/around the
            glass card's edges exactly like the reference instead of being inset along with it. */}
        <div style={{ position: 'absolute', top: -60, right: -60, width: 280, height: 280, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -40, left: '30%', width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '20%', left: -30, width: 120, height: 120, borderRadius: '50%', background: 'rgba(39,114,160,0.3)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -20, right: '20%', width: 150, height: 150, borderRadius: '50%', background: 'rgba(30,81,110,0.4)', pointerEvents: 'none' }} />

        <div
          style={{
            // New Rizo's own card (ESSDashboard.jsx) — inset via margin on the card itself (not a
            // padded parent wrapper), so the blobs above can peek out around its edges.
            margin: '20px 28px',
            borderRadius: 18,
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.1)',
            padding: '22px 28px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <div className="flex flex-row items-center gap-8 flex-wrap">

            {/* Left: employee avatar, greeting, shift/contact pills */}
              <div className="flex items-center gap-5 min-w-0">
                <div className="relative shrink-0">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-slate-800 via-indigo-950/80 to-slate-900 border border-slate-600/50 shadow-lg shadow-indigo-950/40 flex items-center justify-center ring-1 ring-white/10">
                    <span className="text-white text-lg sm:text-xl font-bold tracking-wider bg-gradient-to-b from-white to-slate-300 bg-clip-text text-transparent">
                      {getInitials(emp?.first_name as string, emp?.last_name as string)}
                    </span>
                  </div>
                  <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 border-2 border-[#0c1626]" />
                  </span>
                </div>

                <div className="flex flex-col justify-center min-w-0 flex-1" style={{ gap: 10 }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-400" style={{ fontSize: 18 }}>Welcome,</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg sm:text-xl font-bold text-white tracking-tight">{empFirstName || session?.user.loginUserId}!</span>
                      <span aria-label="waving hand" className="inline-flex items-center justify-center text-sm">👋</span>
                    </div>
                    <span className="inline-flex items-center rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" style={{ padding: '2px 8px' }}>
                      Active
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 text-xs">
                    {empMobile && (
                      <a href={`tel:${empMobile}`} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800/70 hover:bg-slate-800 border border-slate-700/60 text-slate-200 hover:text-white transition-all duration-150 group shadow-sm" style={{ padding: '6px 12px' }}>
                        <Phone className="w-3.5 h-3.5 text-sky-400 group-hover:text-sky-300 transition-colors" strokeWidth={2} />
                        <span className="font-medium tracking-wide">{empMobile}</span>
                      </a>
                    )}
                    {empEmail && (
                      <a href={`mailto:${empEmail}`} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800/70 hover:bg-slate-800 border border-slate-700/60 text-slate-200 hover:text-white transition-all duration-150 group shadow-sm truncate max-w-xs" style={{ padding: '6px 12px' }}>
                        <Mail className="w-3.5 h-3.5 text-indigo-400 group-hover:text-indigo-300 transition-colors shrink-0" strokeWidth={2} />
                        <span className="font-medium truncate">{empEmail}</span>
                      </a>
                    )}
                  </div>

                  {shiftInfo.shiftName && (
                    <div className="flex items-center text-xs">
                      <div className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-200 shadow-sm" style={{ padding: '6px 12px' }}>
                        <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" strokeWidth={2} />
                        <span className="font-semibold text-amber-300">{shiftInfo.shiftName}:</span>
                        {shiftInfo.startTime && shiftInfo.endTime && (
                          <span className="font-medium text-slate-200">{fmtTime(shiftInfo.startTime)} – {fmtTime(shiftInfo.endTime)}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {punchStatus && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handlePunch(punchStatus.checkedIn ? 'out' : 'in')}
                        disabled={punching}
                        className={`inline-flex items-center gap-1.5 rounded-lg text-xs font-bold shadow-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${
                          punchStatus.checkedIn
                            ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30'
                            : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30'
                        }`}
                        style={{ padding: '6px 12px' }}
                      >
                        {punchStatus.checkedIn ? <LogOut className="w-3.5 h-3.5" strokeWidth={2} /> : <LogIn className="w-3.5 h-3.5" strokeWidth={2} />}
                        {punching ? 'Please wait…' : punchStatus.checkedIn ? 'Punch OUT' : 'Punch IN'}
                      </button>
                      {punchStatus.checkedIn && (
                        <span className="font-mono text-xs text-slate-200 tabular-nums" title="Working time today">
                          {fmtElapsed(displaySecs)}
                        </span>
                      )}
                      {!punchStatus.checkedIn && punchStatus.lastPunch && (
                        <span className="text-[11px] text-slate-400">
                          Last: {new Date(punchStatus.lastPunch.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · {punchStatus.lastPunch.direction.toUpperCase()}
                        </span>
                      )}
                    </div>
                  )}
                  {punchError && <div className="text-[11px] text-rose-300">{punchError}</div>}
                </div>
              </div>

              {/* Right: company name, nature, address, contact pills */}
              <div className="flex flex-col items-end justify-center shrink-0" style={{ gap: 8, marginLeft: 'auto' }}>
                <div className="flex items-center justify-end gap-2.5 flex-wrap">
                  <span className="text-base sm:text-lg font-extrabold tracking-wide uppercase text-white drop-shadow-sm">
                    {companyInfo?.business_name || 'Your Company'}
                  </span>
                  {businessNature && (
                    <span className="inline-flex items-center rounded-md text-[11px] font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30" style={{ padding: '2px 8px' }}>
                      {businessNature}
                    </span>
                  )}
                </div>

                {addressLine && (
                  <div className="flex items-center justify-end gap-1.5 text-xs text-slate-300">
                    <MapPin className="w-3.5 h-3.5 text-rose-400 shrink-0" strokeWidth={2} />
                    <span className="text-right font-normal text-slate-300" style={{ maxWidth: 320 }}>{addressLine}</span>
                  </div>
                )}

                {(phone || email) && (
                  <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                    {phone && (
                      <a href={`tel:${phone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1.5 rounded-md bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 text-slate-300 hover:text-white transition-colors group" style={{ padding: '4px 10px' }}>
                        <Phone className="w-3 h-3 text-sky-400 group-hover:text-sky-300 transition-colors shrink-0" strokeWidth={2} />
                        <span className="font-medium">{phone}</span>
                      </a>
                    )}
                    {email && (
                      <a href={`mailto:${email}`} className="inline-flex items-center gap-1.5 rounded-md bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 text-slate-300 hover:text-white transition-colors group" style={{ padding: '4px 10px' }}>
                        <Mail className="w-3 h-3 text-indigo-400 group-hover:text-indigo-300 transition-colors shrink-0" strokeWidth={2} />
                        <span className="font-medium">{email}</span>
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
        </div>

        <div style={{ height: 20, background: 'linear-gradient(to bottom, transparent, var(--bg-page))', position: 'relative', zIndex: 1 }} />
      </div>

      <div style={{ padding: '8px 28px 48px' }}>
        {/* TOP ROW — 3 panels, matching New Rizo's `1fr 1fr 300px` grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 300px', gap: 20, alignItems: 'start' }}>

          {/* Panel 1: Leadership Message — no backend feature for this yet, always empty state */}
          <div style={{ height: 440, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <div style={{ fontSize: 42, opacity: 0.25 }}>💬</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>No leadership message yet</div>
            </div>
          </div>

          {/* Panel 2: Company Updates — no announcements feature/table yet, always empty state */}
          <div style={{ height: 440, display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>📢 Company Updates</div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {ANNOUNCEMENT_TABS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setAnnouncementTab(t)}
                    style={{
                      padding: '5px 10px', border: 'none', borderRadius: '6px 6px 0 0', cursor: 'pointer',
                      fontSize: 11, fontWeight: 700, textTransform: 'capitalize',
                      background: announcementTab === t ? '#1E516E' : 'transparent',
                      color: announcementTab === t ? '#fff' : 'var(--text-muted)',
                      transition: 'all 0.12s',
                    }}
                  >
                    {t === 'all' ? 'All' : t === 'urgent' ? '🔴 Urgent' : t === 'important' ? '🟡 Important' : '📌 Pinned'}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 }}>
              <div style={{ fontSize: 32, opacity: 0.2 }}>📢</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                {announcementTab === 'all' ? 'No announcements yet' : `No ${announcementTab} announcements`}
              </div>
            </div>
          </div>

          {/* Panel 3: profile + side cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg, #0c1f2c 0%, #1E516E 55%, #2d7fb8 100%)', padding: '28px 16px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: -20, right: -20, width: 90, height: 90, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} />
              <div style={{ width: 76, height: 76, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', border: '3px solid rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 900, color: '#fff', letterSpacing: '-1px', boxShadow: '0 4px 20px rgba(0,0,0,0.25)', position: 'relative', zIndex: 1 }}>
                {getInitials(emp?.first_name as string, emp?.last_name as string)}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginTop: 12, textAlign: 'center', lineHeight: 1.2, position: 'relative', zIndex: 1 }}>
                {emp ? `${emp.first_name} ${emp.last_name}` : session?.user.loginUserId || '—'}
              </div>
              {emp?.desig_name && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: 600, marginTop: 4, position: 'relative', zIndex: 1 }}>{emp.desig_name}</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
                {emp?.dept_name && <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.85)', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', padding: '2px 10px', borderRadius: 20 }}>{emp.dept_name}</span>}
                {emp?.emp_id && <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.85)', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', padding: '2px 10px', borderRadius: 20 }}>#{emp.emp_id}</span>}
              </div>
            </div>

            {emp?.joining_date && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 16, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{tenureStr(String(emp.joining_date))}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 1 }}>Tenure</div>
                </div>
                <div style={{ width: 1, background: 'var(--border)' }} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{new Date(String(emp.joining_date)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 1 }}>Joined</div>
                </div>
              </div>
            )}

            <div style={{ padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Profile completeness</span>
                <span style={{ fontSize: 12, fontWeight: 900, color: completeness.score >= 80 ? '#16a34a' : completeness.score >= 50 ? '#d97706' : '#dc2626' }}>{completeness.score}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 6, background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 6, width: `${completeness.score}%`, background: completeness.score >= 80 ? '#16a34a' : completeness.score >= 50 ? '#d97706' : '#dc2626', transition: 'width 0.8s ease' }} />
              </div>
              {completeness.missing.length > 0 ? (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {completeness.missing.map((m) => (
                    <span key={m} style={{ fontSize: 9, fontWeight: 700, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', padding: '2px 7px', borderRadius: 6 }}>{m}</span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 10, color: '#16a34a', fontWeight: 700, marginTop: 6 }}>✅ All fields filled</div>
              )}
            </div>
          </div>

          {(expiredDocs.length > 0 || expiringDocs.length > 0) && (
              <div style={{ background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: 14, padding: '12px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#b91c1c', marginBottom: 10 }}>📄 Document Alerts</div>
                {[...expiredDocs.map((d) => ({ ...d, kind: 'expired' as const })), ...expiringDocs.map((d) => ({ ...d, kind: 'expiring' as const }))].map((d, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #fecaca' }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#7f1d1d' }}>{d.document_type}</div>
                      <div style={{ fontSize: 10, color: d.kind === 'expired' ? '#dc2626' : '#d97706', fontWeight: 600 }}>
                        {d.kind === 'expired' ? `Expired ${fmtFull(d.valid_till)}` : `Expires in ${daysUntil(d.valid_till!)}d`}
                      </div>
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 20, background: d.kind === 'expired' ? '#dc2626' : '#d97706', color: '#fff' }}>
                      {d.kind === 'expired' ? 'EXPIRED' : 'EXPIRING'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {upcomingHolidays.length > 0 && (
              <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ padding: '12px 14px 8px', fontSize: 12, fontWeight: 800, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)' }}>🗓 Upcoming Holidays</div>
                {upcomingHolidays.map((h, i) => {
                  const d = daysUntil(h.HOLIDAYDATE);
                  const soon = d <= 7;
                  return (
                    <div key={h.HOLIDAYID} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: i < upcomingHolidays.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ width: 36, textAlign: 'center', background: soon ? '#fef3c7' : 'var(--border)', borderRadius: 7, padding: '3px 0', flexShrink: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.2, color: soon ? '#b45309' : 'var(--text-muted)' }}>{new Date(h.HOLIDAYDATE).toLocaleDateString('en-IN', { day: '2-digit' })}</div>
                        <div style={{ fontSize: 8, textTransform: 'uppercase', fontWeight: 700, color: soon ? '#b45309' : 'var(--text-muted)' }}>{new Date(h.HOLIDAYDATE).toLocaleDateString('en-IN', { month: 'short' })}</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.HOLIDAYNAME}</div>
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: soon ? '#b45309' : 'var(--text-muted)', flexShrink: 0 }}>{d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `${d}d`}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {newJoiners.length > 0 && (
              <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ padding: '12px 14px 8px', fontSize: 12, fontWeight: 800, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>👋 New to the Team</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#16a34a' }}>{newJoiners.length} this month</span>
                </div>
                {newJoiners.slice(0, 4).map((p) => (
                  <div key={p.emp_pkey} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 14px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: 'linear-gradient(135deg, #16a34abb, #16a34a)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff' }}>
                      {getInitials(p.first_name, p.last_name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.first_name} {p.last_name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.desig_name}</div>
                    </div>
                    <div style={{ fontSize: 9, color: '#16a34a', fontWeight: 700, flexShrink: 0 }}>{p.joining_date ? new Date(p.joining_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Celebrations & People */}
        <div style={{ marginTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>🎉 Celebrations &amp; People</div>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            {allEvents.length > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{allEvents.length} event{allEvents.length > 1 ? 's' : ''} this week</span>}
          </div>

          {allEvents.length === 0 ? (
            <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 14, padding: '36px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>🎈</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>No birthdays or work anniversaries this week — check back soon!</div>
            </div>
          ) : (
            <div>
              {todayEvents.length > 0 && (
                <div style={{ marginBottom: upcomingEvents.length > 0 ? 20 : 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.7px', color: '#d97706', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d97706', display: 'inline-block' }} />
                    Today&apos;s Celebrations
                    <div style={{ flex: 1, height: 1, background: '#d9770630' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {todayEvents.map((e) => {
                      const isBday = e.kind === 'birthday';
                      const grad = isBday ? 'linear-gradient(135deg, #fffbeb 0%, #fde68a 50%, #fbbf24 100%)' : 'linear-gradient(135deg, #f5f3ff 0%, #ddd6fe 50%, #a78bfa 100%)';
                      const color = isBday ? '#92400e' : '#4c1d95';
                      const border = isBday ? '#f59e0b' : '#8b5cf6';
                      const emoji = isBday ? '🎂' : '🏅';
                      const sub = isBday ? 'Birthday' : `${e.years} Year${(e.years ?? 0) > 1 ? 's' : ''} at Rizo`;
                      return (
                        <div key={`${e.kind}-${e.emp_pkey}`} style={{ background: grad, border: `2px solid ${border}`, borderRadius: 16, padding: '24px 22px', minWidth: 180, maxWidth: 240, flex: '1 1 180px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
                          <div style={{ position: 'absolute', bottom: -8, right: -4, fontSize: 70, opacity: 0.1, userSelect: 'none', transform: 'rotate(-15deg)' }}>{emoji}</div>
                          <div style={{ width: 60, height: 60, borderRadius: 18, marginBottom: 12, background: `${border}30`, border: `3px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 900, color }}>
                            {getInitials(e.first_name, e.last_name)}
                          </div>
                          <div style={{ fontSize: 15, fontWeight: 800, color, marginBottom: 2, lineHeight: 1.2 }}>{e.first_name} {e.last_name}</div>
                          <div style={{ fontSize: 11, color, opacity: 0.7, marginBottom: 10 }}>{[e.desig_name, e.dept_name].filter(Boolean).join(' · ')}</div>
                          <div style={{ fontSize: 11, fontWeight: 800, color, background: `${border}22`, border: `1px solid ${border}55`, borderRadius: 20, padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            {emoji} {sub}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {upcomingEvents.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--border)', display: 'inline-block' }} />
                    Coming Up This Week
                    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                    {upcomingEvents.map((e) => {
                      const isBday = e.kind === 'birthday';
                      const color = isBday ? '#d97706' : '#7c3aed';
                      const bg = isBday ? '#fffbeb' : '#f5f3ff';
                      const border = isBday ? '#fde68a' : '#ddd6fe';
                      const emoji = isBday ? '🎂' : '🏅';
                      const d = daysUntil(e.thisYearDate.toISOString());
                      return (
                        <div key={`${e.kind}-${e.emp_pkey}`} style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, borderLeft: `4px solid ${color}` }}>
                          <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, background: bg, border: `1.5px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 900, color }}>
                            {getInitials(e.first_name, e.last_name)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.first_name} {e.last_name}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{emoji} {isBday ? 'Birthday' : `${e.years}yr anniversary`}</div>
                          </div>
                          <div style={{ fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20, flexShrink: 0, background: bg, color, border: `1px solid ${border}` }}>
                            {d === 1 ? 'Tomorrow' : `In ${d}d`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
