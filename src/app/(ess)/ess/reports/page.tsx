'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { EssPagination } from '@/components/ess/EssPagination';

const PAGE_SIZE = 10;

// Port of the legacy employee-login reports (EmpreportNewController — the newer report set linked
// from the employee dashboard), in the menu's order: Salary (CTC Detail), Shift Policy (My Shift
// Timings), Attendance/Leave Report, Leave Taken Report (legacy "Leave Details Report") and Holiday
// Calendar; the legacy Leave Details tab was dropped by request. Data comes
// from /api/ess/reports/[report], which ports each action's query.

const BRAND = '#1E516E';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden' };
const cardHead: React.CSSProperties = { padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 };
const thS: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontWeight: 700, fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', background: 'var(--bg-page)', textTransform: 'uppercase', letterSpacing: '0.3px', whiteSpace: 'nowrap' };
const tdS: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)' };
const muted: React.CSSProperties = { color: 'var(--text-muted)' };
const smallBtn: React.CSSProperties = { padding: '6px 14px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontWeight: 700, fontSize: 12, cursor: 'pointer' };

function fmtINR(n?: number | null) { return (Number(n) || 0).toLocaleString('en-IN'); }
function fmtDate(d?: string | null) {
  if (!d) return '—';
  const x = new Date(d.slice(0, 10) + 'T00:00:00');
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function useReport<T>(url: string) {
  const q = useQuery<T>({
    queryKey: ['ess-report', url],
    queryFn: async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'Could not load report');
      return r.json();
    },
  });
  return { data: q.data ?? null, loading: q.isLoading, error: q.error ? q.error.message : '', reload: () => q.refetch() };
}

function Status({ loading, error, empty }: { loading: boolean; error: string; empty?: string }) {
  const msg = loading ? 'Loading…' : error || empty;
  if (!msg) return null;
  return <div style={{ ...card, padding: 28, textAlign: 'center', fontSize: 13, color: error ? '#dc2626' : 'var(--text-muted)' }}>{msg}</div>;
}

interface Employee { name: string; emp_code: string; desig_name: string | null; dept_name: string | null; branch_name: string | null }

function EmployeeCard({ emp }: { emp: Employee | null }) {
  if (!emp) return null;
  const item = (label: string, value: string | null) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, ...muted, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || '—'}</div>
    </div>
  );
  return (
    <div style={{ ...card, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: BRAND, marginBottom: 10 }}>{emp.name}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {item('Employee ID', emp.emp_code)}
        {item('Branch', emp.branch_name)}
        {item('Designation', emp.desig_name)}
        {item('Department', emp.dept_name)}
      </div>
    </div>
  );
}

// ── Month calendar (legacy used FullCalendar month view) ──────────────────────────────────────
interface CalEvent { key: string; title: string; bg: string; fg: string; tooltip?: string; onClick?: () => void }

function MonthCalendar({ month, onMonth, events, selected, right, onDayClick }: {
  month: string; onMonth: (m: string) => void; events: Map<string, CalEvent[]>; selected?: string | null; right?: React.ReactNode;
  onDayClick?: (date: string) => void;
}) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const shift = (n: number) => { const d = new Date(y, m - 1 + n, 1); onMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const navBtn: React.CSSProperties = { ...smallBtn, padding: '5px 11px' };

  return (
    <div style={card}>
      <div style={{ ...cardHead, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={navBtn} onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <button style={navBtn} onClick={() => shift(1)} aria-label="Next month">›</button>
        </div>
        <span style={{ fontSize: 15 }}>{MONTHS[m - 1]} {y}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {right}
          <button style={{ ...navBtn, opacity: month === thisMonth ? 0.5 : 1 }} disabled={month === thisMonth} onClick={() => onMonth(thisMonth)}>Today</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
        {WEEKDAYS.map((d) => <div key={d} style={{ ...thS, textAlign: 'center', padding: '8px 4px' }}>{d}</div>)}
        {cells.map((d, i) => {
          const date = d ? `${month}-${String(d).padStart(2, '0')}` : '';
          const evs = d ? events.get(date) ?? [] : [];
          const isToday = d && date === `${thisMonth}-${String(now.getDate()).padStart(2, '0')}`;
          return (
            <div key={i} onClick={d && onDayClick ? () => onDayClick(date) : undefined} style={{ cursor: d && onDayClick ? 'pointer' : 'default', minHeight: 74, padding: 4, borderRight: (i + 1) % 7 ? '1px solid var(--border)' : 'none', borderBottom: '1px solid var(--border)', background: d ? (selected === date ? 'rgba(30,81,110,0.08)' : 'transparent') : 'var(--bg-page)', minWidth: 0 }}>
              {d && <div style={{ fontSize: 11, fontWeight: isToday ? 900 : 600, color: isToday ? BRAND : 'var(--text-muted)', textAlign: 'right', marginBottom: 3 }}>{d}</div>}
              {evs.map((e) => (
                <div key={e.key} title={e.tooltip} onClick={e.onClick}
                  style={{ background: e.bg, color: e.fg, fontSize: 10.5, fontWeight: 700, borderRadius: 4, padding: '2px 4px', marginBottom: 2, minHeight: 16, cursor: e.onClick ? 'pointer' : 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: e.bg === 'white' ? '1px solid var(--border)' : 'none' }}>
                  {e.title || ' '}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ items }: { items: { label: string; bg: string; fg?: string; code?: string }[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', padding: '12px 16px' }}>
      {items.map((l, i) => (
        <span key={`${l.code ?? l.label}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-primary)' }}>
          <span style={{ background: l.bg, color: l.fg ?? '#fff', borderRadius: 4, padding: '1px 7px', fontSize: 10.5, fontWeight: 800, minWidth: 16, textAlign: 'center' }}>{l.code ?? ' '}</span>
          {l.label}
        </span>
      ))}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 150, flexShrink: 0, fontSize: 12.5, ...muted }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', minWidth: 0, wordBreak: 'break-word' }}>{value === '' || value == null ? '—' : value}</span>
    </div>
  );
}

const thisMonthStr = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`; };

// ── Salary (Cost To Company) ─────────────────────────────────────────────────────────────────
function SalaryReport() {
  const { data, loading, error } = useReport<{ employee: Employee; direct: { name: string; amount: number }[]; indirect: { name: string; amount: number }[]; gross: number; ctc: number }>('/api/ess/reports/salary');
  if (!data) return <Status loading={loading} error={error} />;
  const rows = data.direct.length + data.indirect.length;
  return (
    <>
      <EmployeeCard emp={data.employee} />
      <div style={card}>
        <div style={cardHead}>CTC Detail</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={thS}>Salary Components</th><th style={{ ...thS, textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>
            {rows === 0 ? (
              <tr><td colSpan={2} style={{ ...tdS, textAlign: 'center', ...muted }}>No salary structure assigned</td></tr>
            ) : (
              <>
                {data.direct.map((r, i) => <tr key={`d${i}`}><td style={tdS}>{r.name}</td><td style={{ ...tdS, textAlign: 'right', fontWeight: 700 }}>₹{fmtINR(r.amount)}</td></tr>)}
                <tr style={{ background: 'var(--bg-page)' }}><td style={{ ...tdS, fontWeight: 800 }}>Gross Salary</td><td style={{ ...tdS, textAlign: 'right', fontWeight: 900, color: '#dc2626' }}>₹{fmtINR(data.gross)}</td></tr>
                {data.indirect.map((r, i) => <tr key={`i${i}`}><td style={tdS}>{r.name}</td><td style={{ ...tdS, textAlign: 'right', fontWeight: 700 }}>₹{fmtINR(r.amount)}</td></tr>)}
                <tr style={{ background: 'var(--bg-page)' }}><td style={{ ...tdS, fontWeight: 800 }}>Cost to the Company</td><td style={{ ...tdS, textAlign: 'right', fontWeight: 900, color: '#dc2626' }}>₹{fmtINR(data.ctc)}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Shift Policy (My Shift Timings) ─────────────────────────────────────────────────────────
interface ShiftData {
  employee: Employee;
  shift: null | {
    title: string; days: { day: string; status: 'Full' | 'Half' | 'Off' }[]; start: string; end: string; minsPerDay: number | null;
    rules: { label: string; value: string }[];
    exceptions: { day: string; inTime: string; outTime: string; duration: string; week: string }[];
  };
}

const DAY_STYLE: Record<'Full' | 'Half' | 'Off', { bg: string; fg: string }> = {
  Full: { bg: BRAND, fg: '#fff' },
  Half: { bg: '#ec4899', fg: '#fff' },
  Off: { bg: 'var(--bg-page)', fg: 'var(--text-muted)' },
};

function ShiftReport() {
  const { data, loading, error } = useReport<ShiftData>('/api/ess/reports/shift');
  if (!data) return <Status loading={loading} error={error} />;
  const s = data.shift;
  if (!s) return <Status loading={false} error="" empty="No shift policy assigned" />;
  return (
    <>
      <div style={{ ...card, marginBottom: 16, padding: '18px 20px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between', background: `linear-gradient(135deg, ${BRAND}, #2b6f94)`, border: 'none' }}>
        <div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>My Shift (Primary Shift)</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{s.title}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1.1 }}>{s.start} — {s.end}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>Shift Timing</div>
          {s.minsPerDay ? <span style={{ display: 'inline-block', marginTop: 6, fontSize: 12, fontWeight: 700, background: 'rgba(255,255,255,0.18)', color: '#fff', borderRadius: 20, padding: '3px 10px' }}>🕘 {s.minsPerDay} min / day</span> : null}
        </div>
      </div>

      <div style={{ ...card, marginBottom: 16 }}>
        <div style={cardHead}>Working Days</div>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {s.days.map((d) => (
              <div key={d.day} style={{ width: 58, textAlign: 'center' }}>
                <div style={{ padding: '9px 0', borderRadius: 10, fontSize: 13, fontWeight: 800, background: DAY_STYLE[d.status].bg, color: DAY_STYLE[d.status].fg, border: d.status === 'Off' ? '1px solid var(--border)' : 'none' }}>{d.day}</div>
                <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: d.status === 'Off' ? 'var(--text-muted)' : DAY_STYLE[d.status].bg }}>{d.status}</div>
              </div>
            ))}
          </div>
          <Legend items={[{ label: 'Full Day', bg: BRAND }, { label: 'Half Day', bg: '#ec4899' }, { label: 'Off', bg: '#eef2f7' }]} />
        </div>
      </div>

      <div style={{ ...card, marginBottom: 16 }}>
        <div style={cardHead}>Shift Times &amp; Rules</div>
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          {s.rules.map((r) => (
            <div key={r.label} style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 11.5, ...muted }}>{r.label}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: r.value === 'Disabled' ? 'var(--text-muted)' : 'var(--text-primary)' }}>{r.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={cardHead}>Exceptions</div>
        {s.exceptions.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, fontWeight: 700, ...muted }}>⊖ No Exceptions in shift</div>
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: 260, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Day', 'In Time', 'Out Time', 'Duration', 'Week Count'].map((h) => <th key={h} style={{ ...thS, position: 'sticky', top: 0 }}>{h}</th>)}</tr></thead>
              <tbody>
                {s.exceptions.map((e, i) => (
                  <tr key={i}>
                    <td style={tdS}>{e.day}</td><td style={tdS}>{e.inTime}</td><td style={tdS}>{e.outTime}</td>
                    <td style={tdS}>{e.duration}</td><td style={tdS}>{e.week}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Leave policy (shown in the Attendance/Leave Report's Leave Balance card) ─────────────────
interface LeavePolicy {
  code: string; name: string; typeLabel: string; limitLabel: string; limit: number; monthlyLimit: number; encash: boolean; carryForward: number;
  sandwich: boolean; allowNegative: boolean | null; remarks: string; taken: string; balance: string | number; monthlyBalance: string | number;
}
function Pill({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ flex: '1 1 150px', background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px' }}>
      <div style={{ fontSize: 11.5, ...muted }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: BRAND }}>{value ?? 0}</div>
    </div>
  );
}

// ── Attendance/Leave Report (calendar + details panel + leave balance) ────────────────────────────
interface AttendanceData {
  events: { date: string; title: string; bg: string; fg: string; tooltip: string; clickable: boolean }[];
  legend: { code: string; label: string; bg: string; fg: string }[];
}
interface AttendanceDetails {
  date: string | null;
  employee: { name: string; id: string; branch: string; shift: string };
  punches: { date: string; time: string; status: string; location: string }[];
  summary: { inTime: string; outTime: string; duration: string } | null;
  holiday: string | null;
  leaves: { code: string; type: string; status: string; session: string; remarks: string; authorizedBy: string; authorizedDate: string; approvedBy: string; approvedDate: string }[];
}
const LEAVE_STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  approved: { bg: '#ecfdf5', fg: '#059669' }, authorized: { bg: '#eff6ff', fg: '#2563eb' }, applied: { bg: '#fef9c3', fg: '#854d0e' },
};

function AttendanceReport() {
  const [month, setMonth] = useState(thisMonthStr);
  const { data, loading, error, reload } = useReport<AttendanceData>(`/api/ess/reports/attendance?month=${month}`);
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');

  // With no day picked the panel shows the whole month's punch log, as legacy does on navigation.
  const nextMonth = (() => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; })();
  const detailsUrl = selected ? `/api/ess/reports/attendance-day?date=${selected}` : `/api/ess/reports/attendance-day?start=${month}-01&end=${nextMonth}`;
  const details = useReport<AttendanceDetails>(detailsUrl);

  const events = useMemo(() => {
    // Register statuses that come back white are leave codes (orange) or anything else (slate).
    const leaveCodes = (data?.legend ?? []).filter((l) => l.bg === 'orange' || l.code === 'TC').map((l) => l.code.toUpperCase()).filter(Boolean);
    const map = new Map<string, CalEvent[]>();
    for (const e of data?.events ?? []) {
      if (!e.date.startsWith(month) || !e.title) continue; // absent days render empty in EmpreportNew
      let { bg, fg } = e;
      if (bg === 'white') {
        const t = e.title.toUpperCase();
        bg = leaveCodes.some((c) => t.includes(c)) ? '#f97316' : '#94a3b8';
        fg = '#fff';
      }
      map.set(e.date, [{ key: e.date, title: e.title, bg, fg, tooltip: e.tooltip, onClick: () => setSelected(e.date) }]);
    }
    return map;
  }, [data, month]);

  async function refresh() {
    setRefreshing(true);
    setRefreshMsg('');
    try {
      const res = await fetch('/api/ess/reports/attendance-refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error ?? 'Refresh failed');
      reload();
      details.reload();
    } catch (e) {
      setRefreshMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  const changeMonth = (m: string) => { setMonth(m); setSelected(null); setRefreshMsg(''); };
  const d = details.data;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button style={{ ...smallBtn, background: BRAND, color: '#fff', border: 'none', opacity: refreshing ? 0.6 : 1 }} disabled={refreshing} onClick={refresh}>
          ⟳ {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <MonthCalendar month={month} onMonth={changeMonth} events={events} selected={selected} onDayClick={setSelected} />
          {(loading || error || refreshMsg) && <div style={{ fontSize: 12, color: error || refreshMsg ? '#dc2626' : 'var(--text-muted)' }}>{loading ? 'Loading…' : error || refreshMsg}</div>}
          <LeaveBalanceCard />
        </div>

        <div style={card}>
          <div style={{ ...cardHead, flexWrap: 'wrap' }}>
            <span>Attendance Details</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {selected && <span style={{ fontSize: 12, fontWeight: 700, background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 10px' }}>{fmtDate(selected)}</span>}
            </div>
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {details.loading || !d ? (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 13, ...muted }}>{details.error || 'Loading…'}</div>
            ) : (
              <>
                {d.employee.name && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: BRAND }}>{d.employee.name}</div>
                      <div style={{ fontSize: 12, ...muted }}>ID: {d.employee.id} | {d.employee.branch}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>Today shift: {d.employee.shift || '—'}</div>
                    </div>
                    {d.punches.length > 0 && (
                      <span style={{ fontSize: 12, fontWeight: 700, background: '#eff6ff', color: '#1d4ed8', borderRadius: 8, padding: '4px 10px' }}>
                        {fmtDate(d.punches[0].date)}{d.punches[0].date !== d.punches[d.punches.length - 1].date ? ` → ${fmtDate(d.punches[d.punches.length - 1].date)}` : ''}
                      </span>
                    )}
                  </div>
                )}

                {d.holiday && (
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: 12 }}>
                    <span style={{ width: 40, height: 40, borderRadius: 10, background: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>★</span>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#3b82f6', textTransform: 'uppercase' }}>Public Holiday</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#1e3a5f' }}>{d.holiday}</div>
                    </div>
                  </div>
                )}

                {d.leaves.length > 0 && (
                  <div style={{ border: '1px solid #fed7aa', background: '#fff7ed', borderRadius: 12, padding: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#c2410c', marginBottom: 8 }}>Leave on This Day</div>
                    {d.leaves.map((l, i) => {
                      const st = LEAVE_STATUS_STYLE[l.status.toLowerCase()] ?? LEAVE_STATUS_STYLE.applied;
                      return (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: i ? 8 : 0, marginTop: i ? 8 : 0, borderTop: i ? '1px solid #fed7aa' : 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {l.code && <span style={{ background: '#f97316', color: '#fff', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 800 }}>{l.code}</span>}
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{l.type}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, color: '#64748b' }}>🕘 {l.session}</span>
                            <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 10px', borderRadius: 12, background: st.bg, color: st.fg }}>{l.status}</span>
                          </div>
                          {(l.authorizedBy || l.approvedBy) && (
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: '#475569' }}>
                              {l.authorizedBy && <span><span style={{ color: '#94a3b8' }}>Authorized:</span> <b>{l.authorizedBy}</b>{l.authorizedDate && <span style={{ color: '#94a3b8' }}> ({fmtDate(l.authorizedDate)})</span>}</span>}
                              {l.approvedBy && <span><span style={{ color: '#94a3b8' }}>Approved:</span> <b>{l.approvedBy}</b>{l.approvedDate && <span style={{ color: '#94a3b8' }}> ({fmtDate(l.approvedDate)})</span>}</span>}
                            </div>
                          )}
                          {l.remarks && <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>💬 {l.remarks}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {d.summary && (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {d.summary.inTime && <span style={{ padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: '#ecfdf5', color: '#059669', border: '1px solid #bbf7d0' }}>↘ In: {d.summary.inTime}</span>}
                    {d.summary.outTime && <span style={{ padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>↗ Out: {d.summary.outTime}</span>}
                    {d.summary.duration && <span style={{ padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>🕘 {d.summary.duration} mins</span>}
                  </div>
                )}

                {d.punches.length > 0 ? (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 8, borderBottom: '1px solid var(--border)' }}>
                      <button style={{ ...smallBtn, background: BRAND, color: '#fff', border: 'none' }} onClick={() => { window.location.href = detailsUrl.replace('/attendance-day?', '/attendance-excel?'); }}>⬇ Export Excel</button>
                    </div>
                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr>{['Date', 'Time', 'Status', 'Location'].map((h) => <th key={h} style={{ ...thS, position: 'sticky', top: 0, background: BRAND, color: '#fff' }}>{h}</th>)}</tr></thead>
                        <tbody>
                          {d.punches.map((p, i) => {
                            const isIn = p.status.toLowerCase() === 'check in' || p.status.toLowerCase() === 'in';
                            return (
                              <tr key={i}>
                                <td style={tdS}>{fmtDate(p.date)}</td>
                                <td style={{ ...tdS, fontWeight: 700 }}>{p.time}</td>
                                <td style={tdS}><span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 800, background: isIn ? '#ecfdf5' : '#fef2f2', color: isIn ? '#059669' : '#dc2626', textTransform: 'capitalize' }}>{isIn ? '↘' : '↗'} {p.status}</span></td>
                                <td style={{ ...tdS, ...muted }}>{p.location || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : d.leaves.length === 0 && (
                  <div style={{ padding: '40px 20px', textAlign: 'center', border: '1px solid var(--border)', borderRadius: 12 }}>
                    <div style={{ fontSize: 34, color: '#cbd5e1' }}>🗓</div>
                    <div style={{ fontSize: 15, fontWeight: 700, ...muted }}>No Punch Records Found</div>
                    <div style={{ fontSize: 13, color: '#94a3b8' }}>No check-in / check-out logs for the selected period.</div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// EmpreportNew's Attendance page loads leavepolicyreport/json into a "Leave Balance" tab card.
const LEAVE_TYPE_SHORT: Record<string, string> = { Yearly: 'Yearly', Monthly: 'Monthly', Quarterly: 'Quarterly', 'Half-Yearly': 'Half Yearly', 'Present Days': 'Present Days' };
function LeaveBalanceCard() {
  const { data, loading, error } = useReport<{ policies: LeavePolicy[] }>('/api/ess/reports/leave-policy');
  const [tab, setTab] = useState(0);
  const p = data?.policies[tab];
  return (
    <div style={card}>
      <div style={{ ...cardHead, flexWrap: 'wrap' }}>
        <span>Leave Balance</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(data?.policies ?? []).map((x, i) => (
            <button key={`${x.code}-${i}`} onClick={() => setTab(i)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 800, background: i === tab ? BRAND : 'var(--bg-page)', color: i === tab ? '#fff' : 'var(--text-primary)' }}>{x.code || '-'}</button>
          ))}
        </div>
      </div>
      {loading ? <div style={{ padding: 16, textAlign: 'center', fontSize: 13, ...muted }}>Loading…</div>
        : error ? <div style={{ padding: 16, textAlign: 'center', fontSize: 13, ...muted }}>Unable to load</div>
        : !p ? <div style={{ padding: 16, textAlign: 'center', fontSize: 13, ...muted }}>No leave data available</div>
        : (
          <div style={{ padding: '8px 16px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', padding: '6px 0' }}>
              <span>{p.name}</span><span style={{ color: BRAND }}>{p.code}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '2px 16px' }}>
              <DetailRow label="Leave Type" value={LEAVE_TYPE_SHORT[p.typeLabel] ?? p.typeLabel} />
              <DetailRow label="Monthly Limit" value={p.monthlyLimit} />
              <DetailRow label="Leave Encash" value={p.encash ? 'Yes' : 'No'} />
              <DetailRow label="Carry Forward Limit" value={p.carryForward} />
              <DetailRow label="Sandwich Leave" value={p.sandwich ? 'Yes' : 'No'} />
              <DetailRow label="Allow Negative" value={p.allowNegative ? 'Yes' : 'No'} />
            </div>
            {p.remarks && <div style={{ fontSize: 12.5, marginTop: 8, ...muted }}>Remarks : <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{p.remarks}</span></div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
              <Pill label={`Leave Taken (${p.code})`} value={Number(p.taken)} />
              <Pill label="Balance (As Per Current Date)" value={p.balance} />
            </div>
          </div>
        )}
    </div>
  );
}

// ── Leave Taken Report (legacy "Leave Details Report" table) ─────────────────────────────────────────────────────────────
interface LeaveRow {
  id: number; appliedDate: string; from: string; to: string; reason: string; handoverTo: string;
  authorizedBy: string; authorizedRemark: string; authorizedDate: string; approvedBy: string; approvedRemark: string; approvedDate: string;
  rejectedBy: string; rejectedRemark: string; rejectedDate: string; leaveType: string; days: number; status: string;
}
// EmpreportNew's column order (same as its Excel export).
const LEAVE_COLS: [string, (r: LeaveRow) => string][] = [
  ['Applied Date', (r) => r.appliedDate], ['From Date', (r) => r.from], ['To Date', (r) => r.to], ['Reason', (r) => r.reason],
  ['Duties Handed over To', (r) => r.handoverTo], ['Authorized By', (r) => r.authorizedBy], ['Authorized Person Remark', (r) => r.authorizedRemark],
  ['Authorized Date', (r) => r.authorizedDate], ['Approved By', (r) => r.approvedBy], ['Approved Person Remark', (r) => r.approvedRemark],
  ['Approved Date', (r) => r.approvedDate], ['Rejected By', (r) => r.rejectedBy], ['Rejected Person Remark', (r) => r.rejectedRemark],
  ['Rejected Date', (r) => r.rejectedDate], ['Leave Type', (r) => r.leaveType], ['Leave Days', (r) => String(r.days ?? '')],
  ['Leave Status', (r) => r.status],
];

function LeaveDetailsTable() {
  const { data, loading, error } = useReport<{ employee: Employee; rows: LeaveRow[] }>('/api/ess/reports/leave-details');
  const [page, setPage] = useState(1);
  if (!data) return <Status loading={loading} error={error} />;

  // Legacy's EmpreportNew/leavedetailsreport/excel: a real .xlsx built server-side.
  function exportExcel() {
    window.location.href = '/api/ess/reports/leave-details-excel';
  }

  return (
    <div style={card}>
      <div style={cardHead}>
        <span>Leave Taken Report</span>
        <button onClick={exportExcel} disabled={data.rows.length === 0} style={{ ...smallBtn, background: '#16a34a', color: '#fff', border: 'none', opacity: data.rows.length ? 1 : 0.5 }}>⬇ Excel</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={thS}>Sl No</th>{LEAVE_COLS.map(([h]) => <th key={h} style={thS}>{h}</th>)}</tr></thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr><td colSpan={LEAVE_COLS.length + 1} style={{ ...tdS, textAlign: 'center', ...muted }}>No leave history</td></tr>
            ) : data.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r, i) => (
              <tr key={r.id}>
                <td style={{ ...tdS, ...muted }}>{(page - 1) * PAGE_SIZE + i + 1}</td>
                {LEAVE_COLS.map(([h, f]) => <td key={h} style={{ ...tdS, whiteSpace: h === 'Reason' || h.endsWith('Remark') ? 'normal' : 'nowrap', minWidth: h === 'Reason' || h.endsWith('Remark') ? 160 : undefined, fontWeight: h === 'Leave Status' || h === 'Leave Days' ? 700 : 400 }}>{f(r) || '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <EssPagination page={page} pageSize={PAGE_SIZE} totalItems={data.rows.length} onChange={setPage} />
    </div>
  );
}

// ── Holiday Calendar ─────────────────────────────────────────────────────────────────────────
function HolidayCalendar() {
  const { data, loading, error } = useReport<{ holidays: { id: number; name: string; date: string; type: string; description: string; color: string }[] }>('/api/ess/reports/holidays');
  const [month, setMonth] = useState(thisMonthStr);

  const events = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const h of data?.holidays ?? []) {
      const list = map.get(h.date) ?? [];
      list.push({ key: `${h.id}`, title: h.name, bg: h.color, fg: '#fff', tooltip: h.description || h.name });
      map.set(h.date, list);
    }
    return map;
  }, [data]);

  if (!data) return <Status loading={loading} error={error} />;
  const year = month.slice(0, 4);
  const yearHolidays = data.holidays.filter((h) => h.date.startsWith(year));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
      <MonthCalendar month={month} onMonth={setMonth} events={events} />
      <div style={card}>
        <div style={cardHead}>Holidays in {year}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Holiday', 'Holiday Date', 'Holiday Type', 'Description'].map((h) => <th key={h} style={thS}>{h}</th>)}</tr></thead>
          <tbody>
            {yearHolidays.length === 0 ? (
              <tr><td colSpan={4} style={{ ...tdS, textAlign: 'center', ...muted }}>No holidays in {year}</td></tr>
            ) : yearHolidays.map((h) => (
              <tr key={h.id} onClick={() => setMonth(h.date.slice(0, 7))} style={{ cursor: 'pointer' }}>
                <td style={tdS}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: h.color, marginRight: 8 }} />{h.name}</td>
                <td style={{ ...tdS, whiteSpace: 'nowrap' }}>{fmtDate(h.date)}</td>
                <td style={tdS}>{h.type || '—'}</td>
                <td style={{ ...tdS, ...muted }}>{h.description || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const REPORTS = [
  { id: 'salary', label: 'CTC Detail', emoji: '💰' },
  { id: 'shift', label: 'My Shift Timings', emoji: '🕘' },
  { id: 'attendance', label: 'Attendance/Leave Report', emoji: '📊' },
  { id: 'leavereport', label: 'Leave Taken Report', emoji: '📋' },
  { id: 'holiday', label: 'Holiday Calendar', emoji: '📅' },
] as const;
type ReportId = typeof REPORTS[number]['id'];

export default function EssReportsPage() {
  const { data: session } = useSession();
  const empId = session?.user.empFkey;
  const [active, setActive] = useState<ReportId>('salary');

  if (!empId) return null;

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Reports</h1>
          <p className="page-subtitle">Salary, shift policy, leave, attendance and holiday reports</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 6, marginBottom: 20, overflowX: 'auto' }}>
        {REPORTS.map((r) => (
          <button key={r.id} onClick={() => setActive(r.id)} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: active === r.id ? 700 : 500, fontSize: 13, background: active === r.id ? BRAND : 'transparent', color: active === r.id ? '#fff' : 'var(--text-primary)' }}>
            <span>{r.emoji}</span> {r.label}
          </button>
        ))}
      </div>

      {active === 'salary' && <SalaryReport />}
      {active === 'shift' && <ShiftReport />}
      {active === 'attendance' && <AttendanceReport />}
      {active === 'leavereport' && <LeaveDetailsTable />}
      {active === 'holiday' && <HolidayCalendar />}
    </div>
  );
}
