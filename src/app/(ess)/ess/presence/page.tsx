'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import AppTabs from '@/components/ess/AppTabs';

// Port of New Rizo's pages/ESS/ESSPresence.jsx, backed by /api/employees/[id]/presence-summary
// (which already supports ?month= and returns per-day worked_minutes, so the month picker and
// Daily Working Hours / Leave Trend charts below are real, not fabricated) and the already
// self-scoped leave/* routes. Simplifications versus the original, driven by what the real data
// actually contains:
// - Leave balance cards show only the final balance (leave_balance_inthe_year_fn / _month_fn) —
//   lib/leave.ts's getLeaveBalance never computed an opening/credited/taken breakdown, so New
//   Rizo's 4-stat leave-card breakdown isn't reconstructable from real data.
// - No shift-override control on the day-detail popup — that's an admin/payroll concern
//   (PUT /api/attendance/daily-shift doesn't exist here), so the popup is read-only.
// - Authorizer/Approver are shown read-only (auto-resolved via /api/leave/authorizers from the
//   real reporting hierarchy) rather than manual dropdowns, matching the same choice made for
//   Requests/Approvals.
// - No inline "Pending Approvals" section — that's the dedicated Approvals page; duplicating it
//   here would just be the same data in two places.

const BRAND = '#1E516E';
const LEAVE_COLOR = '#006398';
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// EssLegacyShell's own theme state (`isDark`) is local to that component and isn't exposed via
// context, so it can't just be imported — this reads the same `data-theme` attribute it sets on
// the `.ess-legacy` root and stays in sync via MutationObserver, so a live toggle updates the
// hardcoded status-color backgrounds below without needing a page refresh.
function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const root = document.querySelector('.ess-legacy');
    if (!root) return;
    const update = () => setIsDark(root.getAttribute('data-theme') === 'dark');
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function fmtMonth(m: string) { const [y, mo] = m.split('-'); return `${MONTHS_SHORT[parseInt(mo) - 1]} ${y}`; }
function fmtMins(mins?: number | null) { if (!mins) return '—'; const h = Math.floor(mins / 60), rm = mins % 60; return h > 0 ? `${h}h ${rm}m` : `${rm}m`; }
function fmtTime(t?: string | null) {
  if (!t) return '—';
  const dt = new Date(t);
  if (!isNaN(dt.getTime())) return dt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  return String(t);
}
function fmtTimeShort(t?: string | null) {
  if (!t) return '';
  const dt = new Date(t);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}
// Short caption shown inside each calendar cell — same status data as the click-through detail
// modal, just surfaced without a click so the grid reads at a glance.
function captionFor(cell: DayCell, isToday = false): string {
  if (isToday && (cell.status === 'P' || !cell.status)) return 'Active';
  if (cell.status === 'P') return fmtTimeShort(cell.punch_in);
  if (cell.status === 'WO') return 'W-Off';
  if (cell.status === 'HO') return 'Holiday';
  if (cell.status === 'A') return 'Absent';
  if (cell.status?.includes('LOP') ?? false) return 'LOP';
  if (!cell.status || cell.status === 'NA') return '';
  return 'Leave';
}
// The light pastel `bg` tints below only work on the light theme's white cards — on the dark
// theme's navy cards they'd render as bright, out-of-place patches, so each status also carries a
// `bgDark` (a dark tint of the same hue) picked at render time via useIsDarkTheme(). `color` (the
// saturated foreground used for text) stays the same in both themes.
const STATUS_CFG: Record<string, { label: string; color: string; bg: string; bgDark: string }> = {
  P: { label: 'Present', color: '#16a34a', bg: '#f0fdf4', bgDark: '#0f2a1a' },
  A: { label: 'Absent', color: '#dc2626', bg: '#fef2f2', bgDark: '#2a1416' },
  WO: { label: 'Weekend', color: '#94a3b8', bg: '#f1f5f9', bgDark: '#182634' },
  HO: { label: 'Holiday', color: '#7c3aed', bg: '#f5f3ff', bgDark: '#1f1a33' },
  NA: { label: 'Not processed', color: '#94a3b8', bg: '#f8fafc', bgDark: '#111c28' },
  // Same red as Absent (LOP counts toward the same "Absent" ribbon stat) — only the label differs,
  // shown in the day caption/detail panel for anyone who checks a specific day.
  LOP: { label: 'LOP', color: '#dc2626', bg: '#fef2f2', bgDark: '#2a1416' },
};
function cfgFor(status: string | null, isDark = false) {
  const entry = status ? STATUS_CFG[status] : null;
  if (entry) return { label: entry.label, color: entry.color, bg: isDark ? entry.bgDark : entry.bg };
  if (!status) return { label: 'No data', color: '#cbd5e1', bg: isDark ? '#111c28' : '#f8fafc' };
  return { label: status, color: LEAVE_COLOR, bg: isDark ? '#0f2233' : '#eff8ff' };
}

// ── Attendance bar chart ──────────────────────────────────────────────────────
// `targetDays` is the real working-day count for the currently-viewed month (not an invented
// policy number) — used as a rough per-month reference line since monthlyAttendance itself
// doesn't carry a working-day count for every historical month.
function AttendanceBarsChart({ months, targetDays }: { months: { month: string; present: number; absent: number; leave_days: number }[]; targetDays?: number }) {
  if (!months.some((m) => m.present || m.absent)) return <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No processed attendance data yet</div>;
  const W = 400, H = 200, PL = 24, PR = 4, PT = 10, PB = 24;
  const cW = W - PL - PR, cH = H - PT - PB;
  const maxPresent = Math.max(...months.map((m) => m.present), targetDays ?? 0, 5);
  const n = months.length;
  const slotW = cW / n;
  const barW = Math.max(6, slotW - 6);
  const yMax = Math.ceil(maxPresent / 5) * 5 || 25;
  const targetY = targetDays ? PT + cH - (targetDays / yMax) * cH : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }}>
      {[0, yMax / 2, yMax].map((v) => {
        const y = PT + cH - (v / yMax) * cH;
        return <g key={v}><line x1={PL} x2={W - PR} y1={y} y2={y} stroke="var(--border)" strokeWidth={0.5} strokeDasharray="3,3" /><text x={PL - 3} y={y + 3} fontSize={6.5} textAnchor="end" fill="var(--text-muted)">{Math.round(v)}</text></g>;
      })}
      {months.map((m, i) => {
        const isCurrent = i === months.length - 1;
        const total = m.present + m.absent;
        const pct = total > 0 ? m.present / total : 0;
        const color = isCurrent ? BRAND : total === 0 ? '#e2e8f0' : pct >= 0.9 ? '#16a34a' : pct >= 0.7 ? '#f59e0b' : '#dc2626';
        const barH = (m.present / yMax) * cH;
        const x = PL + i * slotW + (slotW - barW) / 2;
        const y = PT + cH - barH;
        const [, mo] = m.month.split('-');
        return (
          <g key={m.month}>
            <rect x={x} y={y} width={barW} height={Math.max(barH, 1)} fill={color} rx={Math.min(4, barW / 2)} opacity={0.9}><title>{fmtMonth(m.month)}: {m.present} present, {m.absent} absent</title></rect>
            {m.present > 0 && <text x={x + barW / 2} y={y - 3} fontSize={6.5} textAnchor="middle" fill={color} fontWeight={700}>{m.present}</text>}
            <text x={x + barW / 2} y={H - PB + 11} fontSize={6.5} textAnchor="middle" fill={isCurrent ? BRAND : 'var(--text-muted)'} fontWeight={isCurrent ? 700 : 400}>{MONTHS_SHORT[parseInt(mo) - 1]}</text>
          </g>
        );
      })}
      {targetY !== null && (
        <g>
          <line x1={PL} x2={W - PR} y1={targetY} y2={targetY} stroke="#94a3b8" strokeWidth={1} strokeDasharray="4,3" opacity={0.7} />
          <text x={W - PR} y={targetY - 3} fontSize={6.5} textAnchor="end" fill="#94a3b8">Target ({targetDays}d)</text>
        </g>
      )}
    </svg>
  );
}

// ── Daily working hours chart ─────────────────────────────────────────────────
function WorkingHoursChart({ days, fullDayMins, halfDayMins }: { days: DayCell[]; fullDayMins: number; halfDayMins: number }) {
  const workDays = days.filter((d) => d.status && d.status !== 'WO' && d.status !== 'HO');
  const hasLoggedHours = workDays.some((d) => (d.worked_minutes || 0) > 0);
  if (!workDays.length || !hasLoggedHours) return <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No working hours recorded this month</div>;

  const W = 400, H = 200, PL = 26, PR = 4, PT = 10, PB = 24;
  const cW = W - PL - PR, cH = H - PT - PB;
  const fullH = fullDayMins / 60;
  const halfH = halfDayMins / 60;
  const step = 2;
  // Gridlines every 2 hours up to a clean rounded top (instead of just 0/half/full), with the
  // half/full-day marks picked out in color since they fall on this same 2h grid for a typical
  // 8h/4h shift — falls back to also drawing them separately if a shift's half/full hours aren't
  // even multiples of 2.
  const topGrid = Math.max(Math.ceil((fullH * 1.3) / step) * step, step);
  const yMax = topGrid;
  const gridSet = new Set<number>([0, fullH, halfH]);
  for (let v = 0; v <= topGrid; v += step) gridSet.add(v);
  const yLines = [...gridSet].filter((v) => v <= yMax).sort((a, b) => a - b);
  const n = workDays.length;
  const slotW = cW / Math.max(n, 1);
  const barW = Math.max(4, slotW - 4);
  const toY = (h: number) => PT + cH - (h / yMax) * cH;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
        {yLines.map((v) => {
          const y = toY(v);
          const isRef = v === fullH || v === halfH;
          const refColor = v === fullH ? '#16a34a' : '#f59e0b';
          return (
            <g key={v}>
              <line x1={PL} x2={W - PR} y1={y} y2={y} stroke={isRef ? refColor : 'var(--border)'} strokeWidth={isRef ? 1 : 0.5} strokeDasharray={isRef ? '4,3' : '3,3'} opacity={isRef ? 0.7 : 0.8} />
              <text x={PL - 3} y={y + 3} fontSize={6.5} textAnchor="end" fill={isRef ? refColor : 'var(--text-muted)'}>{v === 0 ? '0' : `${v}h`}</text>
            </g>
          );
        })}
        {workDays.map((d, i) => {
          const wm = d.worked_minutes || 0;
          const wh = wm / 60;
          const barH = (wh / yMax) * cH;
          const x = PL + i * slotW + (slotW - barW) / 2;
          const color = wh >= fullH ? '#16a34a' : wh >= halfH ? '#f59e0b' : wm > 0 ? '#dc2626' : '#e2e8f0';
          const y = toY(wh);
          return (
            <g key={d.date}>
              <rect x={x} y={Math.max(y, PT)} width={barW} height={Math.max(barH, 1)} fill={color} rx={2} opacity={0.85}><title>{DOW_FULL[d.dow]} {d.day}: {fmtMins(wm)} worked</title></rect>
              <text x={x + barW / 2} y={H - PB + 11} fontSize={6.5} textAnchor="middle" fill="var(--text-muted)">{d.day}</text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 8 }}>
        {[['#16a34a', `Full (${fullH}h)`], ['#f59e0b', `Half (${halfH}h)`], ['#dc2626', 'Short']].map(([c, l]) => (
          <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: c, flexShrink: 0 }} />
            <span style={{ color: 'var(--text-muted)' }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Leave trend chart ─────────────────────────────────────────────────────────
function LeaveTrendChart({ months }: { months: { month: string; leave_days: number }[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 400, H = 160, PL = 20, PR = 8, PT = 8, PB = 22;
  const cW = W - PL - PR, cH = H - PT - PB;
  const maxL = Math.max(...months.map((m) => m.leave_days), 5);
  const n = months.length;
  const pts = months.map((m, i) => ({
    x: PL + (i / Math.max(n - 1, 1)) * cW,
    y: PT + cH - (m.leave_days / maxL) * cH,
    m,
  }));
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const polygon = `${pts[0].x},${PT + cH} ${polyline} ${pts[pts.length - 1].x},${PT + cH}`;
  const hovered = hoverIdx !== null ? pts[hoverIdx] : null;
  // Custom tooltip instead of the native SVG <title> (which has a slow OS-level hover delay and
  // can't be styled) — clamped horizontally so it never renders past the chart edges.
  const tw = 60, th = 24;
  const tx = hovered ? Math.max(2, Math.min(W - tw - 2, hovered.x - tw / 2)) : 0;
  const ty = hovered ? Math.max(2, hovered.y - th - 8) : 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, overflow: 'visible' }}>
      <defs>
        <linearGradient id="lgFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={LEAVE_COLOR} stopOpacity={0.3} />
          <stop offset="100%" stopColor={LEAVE_COLOR} stopOpacity={0.03} />
        </linearGradient>
      </defs>
      <polygon points={polygon} fill="url(#lgFill)" />
      <polyline points={polyline} fill="none" stroke={LEAVE_COLOR} strokeWidth={2} strokeLinejoin="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={hoverIdx === i ? 4 : 3} fill={LEAVE_COLOR} stroke="var(--bg-card)" strokeWidth={1.5} pointerEvents="none" />
          {/* Larger transparent hit-area so hovering near a point (not just its 3px dot) triggers the tooltip. */}
          <circle
            cx={p.x} cy={p.y} r={9} fill="transparent" style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}
          />
          <text x={p.x} y={H - PB + 11} fontSize={7} textAnchor="middle" fill={hoverIdx === i ? LEAVE_COLOR : 'var(--text-muted)'} fontWeight={hoverIdx === i ? 700 : 400}>{MONTHS_SHORT[parseInt(p.m.month.slice(5, 7)) - 1]}</text>
        </g>
      ))}
      {hovered && (
        <g pointerEvents="none">
          <line x1={hovered.x} x2={hovered.x} y1={PT} y2={PT + cH} stroke={LEAVE_COLOR} strokeWidth={1} strokeDasharray="2,2" opacity={0.35} />
          <rect x={tx} y={ty} width={tw} height={th} rx={5} fill="#1e293b" />
          <text x={tx + tw / 2} y={ty + 10} fontSize={6.5} textAnchor="middle" fill="#cbd5e1" fontWeight={600}>{fmtMonth(hovered.m.month)}</text>
          <text x={tx + tw / 2} y={ty + 19} fontSize={7.5} textAnchor="middle" fill="#fff" fontWeight={800}>{hovered.m.leave_days} day{hovered.m.leave_days === 1 ? '' : 's'}</text>
        </g>
      )}
    </svg>
  );
}

// ── Custom month picker (replaces the native <input type="month">, whose OS/browser popup
// can't be styled and looks jarring against the app's own hero) ────────────────
function MonthPickerDropdown({ value, max, onChange }: { value: string; max: string; onChange: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => parseInt(value.slice(0, 4), 10));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const [selYear, selMon] = value.split('-').map(Number);
  const [maxYear, maxMon] = max.split('-').map(Number);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => { if (!open) setViewYear(parseInt(value.slice(0, 4), 10)); setOpen((o) => !o); }}
        style={{ background: 'none', border: 'none', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: '2px 4px' }}
      >
        📅 {fmtMonth(value)}
      </button>
      {open && (
        // Theme-aware (var(--bg-card) etc.), same as every modal/popover elsewhere in this app —
        // centered under the trigger button (not right/left-anchored) so it lines up predictably
        // regardless of how wide the "📅 Month, Year" label happens to render.
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 16px 40px rgba(0,0,0,0.35)', padding: 12, zIndex: 50, width: 216 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button onClick={() => setViewYear((y) => y - 1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--text-muted)', padding: 2 }}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{viewYear}</span>
            <button
              onClick={() => viewYear < maxYear && setViewYear((y) => y + 1)}
              disabled={viewYear >= maxYear}
              style={{ background: 'none', border: 'none', cursor: viewYear >= maxYear ? 'default' : 'pointer', fontSize: 14, color: viewYear >= maxYear ? 'var(--border)' : 'var(--text-muted)', padding: 2 }}
            >›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {MONTHS_SHORT.map((m, i) => {
              const mm = i + 1;
              const isFuture = viewYear > maxYear || (viewYear === maxYear && mm > maxMon);
              const isSelected = viewYear === selYear && mm === selMon;
              return (
                <button
                  key={m}
                  disabled={isFuture}
                  onClick={() => { onChange(`${viewYear}-${String(mm).padStart(2, '0')}`); setOpen(false); }}
                  style={{
                    padding: '6px 0', borderRadius: 8, fontSize: 11, fontWeight: 700,
                    cursor: isFuture ? 'default' : 'pointer',
                    border: isSelected ? `1.5px solid ${BRAND}` : '1px solid transparent',
                    background: isSelected ? `${BRAND}18` : 'transparent',
                    color: isFuture ? 'var(--border)' : isSelected ? BRAND : 'var(--text-primary)',
                  }}
                >{m}</button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small radial progress ring (used by the monthly breakdown ribbon) ──────────
function RadialRing({ pct, color, size = 34 }: { pct: number; color: string; size?: number }) {
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      {/* Track uses the ring's own color at low opacity, not the generic hairline-border color —
          that's too pale to read as a ring shape on its own card, especially at 0% where no
          colored arc is drawn at all and the "ring" would otherwise be almost invisible. */}
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeOpacity={0.16} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - clamped)} strokeLinecap="round" />
    </svg>
  );
}

// ── Month calendar (columns stretch to fill the card width) ────────────────────
interface DayCell { date: string; day: number; dow: number; status: string | null; punch_in: string | null; punch_out: string | null; worked_minutes: number | null }

function MonthCalendar({ days, today, isCurrentMonth, onDayClick, isDark }: { days: DayCell[]; today: number; isCurrentMonth: boolean; onDayClick: (d: DayCell) => void; isDark: boolean }) {
  const firstDow = days.length ? new Date(days[0].date).getDay() : 0;
  const cells: (DayCell | null)[] = [...Array(firstDow).fill(null), ...days];
  const CELL = 42;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: 9, fontWeight: 800, color: i === 0 || i === 6 ? '#94a3b8' : 'var(--text-muted)' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} style={{ height: CELL }} />;
          // `today` is the elapsed-days cursor from the API, which for a fully-completed past
          // month is just that month's last day (so stats can treat every day as "elapsed") — it
          // does not mean today is actually that date, so the real-today highlight/caption must
          // also check we're viewing the real current month.
          const isFuture = isCurrentMonth && cell.day > today;
          const cfg = cfgFor(cell.status, isDark);
          const isToday = isCurrentMonth && cell.day === today;
          const caption = isFuture ? '' : captionFor(cell, isToday);
          return (
            <div key={i} onClick={() => !isFuture && onDayClick(cell)} title={`${cell.day} ${DOW_FULL[cell.dow]}: ${isFuture ? 'Upcoming' : cfg.label}`}
              style={{ width: '100%', height: CELL, borderRadius: 8, cursor: isFuture ? 'default' : 'pointer', background: isFuture ? 'transparent' : cfg.bg, border: isToday ? `2px solid ${BRAND}` : isFuture ? '1px dashed var(--border)' : `1px solid ${cfg.color}44`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, overflow: 'hidden', boxSizing: 'border-box' }}>
              <span style={{ fontSize: 12, fontWeight: isToday ? 900 : 700, color: isFuture ? 'var(--text-muted)' : cfg.color, lineHeight: 1 }}>{cell.day}</span>
              {caption && <span style={{ fontSize: 8, fontWeight: 700, color: cfg.color, opacity: 0.8, lineHeight: 1, whiteSpace: 'nowrap' }}>{caption}</span>}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 10 }}>
        {['P', 'Leave', 'A', 'WO', 'HO', 'NA'].map((k) => {
          const swatch = k === 'Leave' ? { label: 'Leave', color: LEAVE_COLOR } : STATUS_CFG[k];
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: k === 'NA' ? 'transparent' : swatch.color, border: k === 'NA' ? `1.5px dashed ${swatch.color}` : 'none' }} />
              <span style={{ color: 'var(--text-muted)' }}>{swatch.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Always-visible summary for the selected/default day, sitting inline below the calendar instead
// of behind a click-triggered modal — same fields (check-in/out/duration + status), just always in view.
// When the selected day is today and the employee is currently checked in, the status/duration
// switch to the live punch-status snapshot (same source as the Home page's punch widget) instead
// of the day's `worked_minutes` — that field is populated by end-of-day attendance processing, so
// it can't reflect a shift that's still in progress.
function DayDetailPanel({ day, isToday, punchStatus, fullDayMins, isDark }: { day: DayCell | null; isToday: boolean; punchStatus: { checkedIn: boolean; elapsedSeconds: number; lastPunch: { time: string; direction: string } | null } | null; fullDayMins: number; isDark: boolean }) {
  if (!day) {
    return (
      <div style={{ padding: '12px 14px', background: 'var(--bg-page)', border: '1px dashed var(--border)', borderRadius: 12, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
        Select a day above to see check-in / check-out details
      </div>
    );
  }
  const onDuty = isToday && (punchStatus?.checkedIn ?? false);
  const cfg = onDuty ? { label: 'On Duty', color: '#16a34a', bg: isDark ? '#0f2a1a' : '#f0fdf4' } : cfgFor(day.status, isDark);
  // A working day (Present/Absent/LOP — not a weekend, holiday, leave or not-yet-processed day)
  // with no check-in or no check-out recorded is a genuine punch gap worth flagging — an ongoing
  // shift (onDuty) legitimately has no check-out yet, so that's excluded rather than flagged.
  const isWorkStatus = day.status === 'P' || day.status === 'A' || (day.status?.includes('LOP') ?? false);
  const missingPunch = !onDuty && isWorkStatus && (!day.punch_in || !day.punch_out);
  const btnBase: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, padding: '7px 13px', borderRadius: 8, textDecoration: 'none', whiteSpace: 'nowrap', textAlign: 'center' };

  return (
    <div style={{ padding: '10px 14px', background: 'var(--bg-page)', border: `1px solid ${cfg.color}33`, borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ width: 42, height: 42, borderRadius: 10, background: cfg.bg, border: `1px solid ${cfg.color}44`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: 8, fontWeight: 800, color: cfg.color, textTransform: 'uppercase', lineHeight: 1 }}>{MONTHS_SHORT[parseInt(day.date.split('-')[1]) - 1]}</span>
        <span style={{ fontSize: 16, fontWeight: 900, color: cfg.color, lineHeight: 1.3 }}>{day.day}</span>
      </div>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>{DOW_FULL[day.dow]}</span>
          <span style={{ fontSize: 10, fontWeight: 800, color: cfg.color, background: `${cfg.color}18`, borderRadius: 20, padding: '1px 9px' }}>{onDuty && <span style={{ marginRight: 3 }}>●</span>}{cfg.label}</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
          {onDuty ? (
            <>First in: <strong style={{ color: 'var(--text-primary)' }}>{fmtTime(day.punch_in)}</strong> · Current logged: <strong style={{ color: 'var(--text-primary)' }}>{fmtMins(Math.round((punchStatus?.elapsedSeconds ?? 0) / 60))}</strong> / {fmtMins(fullDayMins)}</>
          ) : day.punch_in || day.punch_out ? (
            <>In: <strong style={{ color: 'var(--text-primary)' }}>{fmtTime(day.punch_in)}</strong> · Out: <strong style={{ color: 'var(--text-primary)' }}>{fmtTime(day.punch_out)}</strong> · Duration: <strong style={{ color: 'var(--text-primary)' }}>{fmtMins(day.worked_minutes)}</strong></>
          ) : (
            <span>No punch recorded</span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {missingPunch && (
          <a href="/ess/requests?tab=regularization" style={{ ...btnBase, color: '#d97706', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>Regularize Log</a>
        )}
        {isToday && (
          <a href="/ess" style={{ ...btnBase, color: '#fff', background: BRAND, border: '1px solid transparent' }}>{onDuty ? 'Punch Out' : 'Punch In'}</a>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
interface Presence {
  employee: { emp_pkey: number; first_name: string; last_name: string; joining_date: string | null; shift_name: string | null; leave_group_name: string | null };
  shiftInfo: { fullDayMins: number; halfDayMins: number; startTime: string | null; endTime: string | null };
  currentMonth: { month: string; today: number; days: DayCell[] } | null;
  monthlyAttendance: { month: string; present: number; absent: number; leave_days: number }[];
}

export default function EssPresencePage() {
  const { data: session } = useSession();
  const empId = session?.user.empFkey;
  const isDark = useIsDarkTheme();

  const [presence, setPresence] = useState<Presence | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const nowMonth = new Date().toISOString().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(nowMonth);
  const [chartTab, setChartTab] = useState<'attendance' | 'hours' | 'leave'>('attendance');
  const [punchStatus, setPunchStatus] = useState<{ checkedIn: boolean; elapsedSeconds: number; lastPunch: { time: string; direction: string } | null } | null>(null);

  const load = useCallback(() => {
    if (!empId) return;
    fetch(`/api/employees/${empId}/presence-summary?month=${selectedMonth}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setPresence)
      .finally(() => setLoading(false));
  }, [empId, selectedMonth]);

  useEffect(() => { load(); }, [load]);
  // Same live punch data the Home page's punch widget uses — surfaced here too so today's
  // check-in status is visible without navigating away from Presence.
  useEffect(() => {
    if (!empId) return;
    fetch('/api/ess/punch/status').then((r) => (r.ok ? r.json() : null)).then(setPunchStatus).catch(() => {});
  }, [empId]);

  if (loading || !presence) {
    return (
      <div style={{ height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: BRAND, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  const { shiftInfo, currentMonth, monthlyAttendance } = presence;

  // Derived (not fabricated) from currentMonth.days — the API doesn't precompute working-days /
  // days-remaining fields the way New Rizo's backend does, but they're a straight read of the
  // same day array New Rizo's own backend would have used to compute them.
  const cmDays = currentMonth?.days ?? [];
  const cmToday = currentMonth?.today ?? 0;
  const elapsedDays = cmDays.filter((d) => d.day <= cmToday);

  // Selected day for the always-visible detail panel: whatever was last clicked, if that date
  // still exists in the currently-loaded month, else default to today (or the last elapsed day,
  // for a past month) — computed at render time rather than synced via an effect.
  const selectedDay = (cmDays.find((d) => d.date === selectedDate) ?? cmDays.find((d) => d.day === cmToday) ?? cmDays[cmDays.length - 1] ?? null);
  const cmData = {
    present: elapsedDays.filter((d) => d.status === 'P').length,
    absent: elapsedDays.filter((d) => d.status === 'A' || (d.status?.includes('LOP') ?? false)).length,
    leave: elapsedDays.filter((d) => d.status && d.status !== 'P' && d.status !== 'A' && d.status !== 'WO' && d.status !== 'HO' && d.status !== 'NA' && !d.status.includes('LOP')).length,
    holiday: cmDays.filter((d) => d.status === 'HO').length,
  };
  const workingDays = cmDays.filter((d) => d.status !== 'WO' && d.status !== 'HO').length;
  const totalWorkedMins = cmDays.reduce((s, d) => s + (d.worked_minutes || 0), 0);
  const elapsedCalendarDays = elapsedDays.length;
  // Present/Leave/Absent are fractions of elapsed WORKING days (weekends/holidays were never an
  // opportunity to be present), not raw elapsed calendar days — dividing by calendar days would
  // silently understate every percentage (e.g. 25 present / 31 calendar days = 81% instead of the
  // correct 25 / 26 working days = 96%, which is what the "N working days" badge next to it means).
  const elapsedWorkingDays = cmData.present + cmData.absent + cmData.leave;
  const pctOfElapsed = (v: number) => (elapsedWorkingDays > 0 ? v / elapsedWorkingDays : 0);

  return (
    <div style={{ background: 'var(--bg-page)', minHeight: '100%' }}>
      <div style={{ background: `linear-gradient(135deg, #0c1f2c 0%, ${BRAND} 55%, #2d7fb8 100%)`, padding: '18px 28px 16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 900, color: '#fff' }}>📊 My Presence</div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.12)', borderRadius: 10, padding: '6px 12px', border: '1px solid rgba(255,255,255,0.2)' }}>
              <button
                onClick={() => { const [y, m] = selectedMonth.split('-').map(Number); const d = new Date(y, m - 2, 1); setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', fontSize: 16, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
              >‹</button>
              <MonthPickerDropdown value={selectedMonth} max={nowMonth} onChange={setSelectedMonth} />
              <button
                onClick={() => { if (selectedMonth >= nowMonth) return; const [y, m] = selectedMonth.split('-').map(Number); const d = new Date(y, m, 1); setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }}
                style={{ background: 'none', border: 'none', color: selectedMonth >= nowMonth ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)', fontSize: 16, cursor: selectedMonth >= nowMonth ? 'default' : 'pointer', padding: '0 4px', lineHeight: 1 }}
              >›</button>
              {selectedMonth !== nowMonth && (
                <button onClick={() => setSelectedMonth(nowMonth)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', fontSize: 10, fontWeight: 700, cursor: 'pointer', borderRadius: 6, padding: '2px 8px' }}>Today</button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 28px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, padding: '14px 16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '10px 28px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>Monthly Working Cycle Breakdown</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 9px' }}>{workingDays} working days</span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>Consolidated presence distribution for {currentMonth ? fmtMonth(currentMonth.month) : 'this month'}</div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 22px' }}>
              {[
                { label: 'Present', val: cmData.present, color: '#16a34a', pct: pctOfElapsed(cmData.present), suffix: `/ ${elapsedWorkingDays}d` },
                { label: 'On Leave', val: cmData.leave, color: LEAVE_COLOR, pct: pctOfElapsed(cmData.leave), suffix: cmData.leave === 1 ? 'day' : 'days' },
                { label: 'Absent', val: cmData.absent, color: '#dc2626', pct: pctOfElapsed(cmData.absent), suffix: cmData.absent === 1 ? 'day' : 'days' },
                { label: 'Holidays', val: cmData.holiday, color: '#7c3aed', pct: elapsedCalendarDays > 0 ? cmData.holiday / elapsedCalendarDays : 0, suffix: cmData.holiday === 1 ? 'day' : 'days' },
              ].map((s) => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <RadialRing pct={s.pct} color={s.color} size={34} />
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: s.color, lineHeight: 1.1 }}>{s.val} <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>{s.suffix}</span></div>
                    <div style={{ fontSize: 9.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{s.label} <span style={{ color: s.color, fontWeight: 700 }}>({Math.round(s.pct * 100)}%)</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'stretch' }}>

          <div style={{ flex: '1.6 1 460px', minWidth: 0, background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>{currentMonth ? `${fmtMonth(currentMonth.month)} — Day by Day` : 'Current Month'}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10 }}>Click any day to inspect it below</div>
              {currentMonth ? (
                <MonthCalendar days={currentMonth.days} today={currentMonth.today} isCurrentMonth={selectedMonth === nowMonth} onDayClick={(d) => setSelectedDate(d.date)} isDark={isDark} />
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Attendance for this month hasn&apos;t been processed yet</div>
              )}
            </div>
            <DayDetailPanel day={selectedDay} isToday={selectedMonth === nowMonth && selectedDay?.day === cmToday} punchStatus={punchStatus} fullDayMins={shiftInfo.fullDayMins} isDark={isDark} />
          </div>

          <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <AppTabs
                tabs={[{ key: 'hours', label: 'Hours' }, { key: 'attendance', label: 'Attendance' }, { key: 'leave', label: 'Leave' }]}
                active={chartTab}
                onChange={(k) => setChartTab(k as 'attendance' | 'hours' | 'leave')}
              />
              {chartTab === 'attendance' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Present days / month</div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 15, fontWeight: 900, color: '#16a34a' }}>{cmData.present}d</span>
                      <span style={{ fontSize: 8.5, color: 'var(--text-muted)', marginLeft: 4 }}>this month</span>
                    </div>
                  </div>
                  <AttendanceBarsChart months={monthlyAttendance} targetDays={workingDays} />
                </>
              )}
              {chartTab === 'hours' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Logged vs full ({shiftInfo.fullDayMins / 60}h) / half ({shiftInfo.halfDayMins / 60}h) day</div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 15, fontWeight: 900, color: BRAND }}>{totalWorkedMins > 0 ? fmtMins(totalWorkedMins) : '0h 0m'}</span>
                      <span style={{ fontSize: 8.5, color: 'var(--text-muted)', marginLeft: 4 }}>this month</span>
                    </div>
                  </div>
                  {currentMonth
                    ? <WorkingHoursChart days={currentMonth.days} fullDayMins={shiftInfo.fullDayMins} halfDayMins={shiftInfo.halfDayMins} />
                    : <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>No data</div>}
                </>
              )}
              {chartTab === 'leave' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Leave days taken / month</div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 15, fontWeight: 900, color: LEAVE_COLOR }}>{cmData.leave}d</span>
                      <span style={{ fontSize: 8.5, color: 'var(--text-muted)', marginLeft: 4 }}>this month</span>
                    </div>
                  </div>
                  {monthlyAttendance.some((m) => m.leave_days > 0)
                    ? <LeaveTrendChart months={monthlyAttendance} />
                    : <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-muted)' }}>No leave days recorded</div>}
                </>
              )}
            </div>

            {punchStatus && (
              <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: punchStatus.checkedIn ? '#f0fdf4' : 'var(--bg-page)', border: `1.5px solid ${punchStatus.checkedIn ? '#16a34a44' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 15 }}>
                  {punchStatus.checkedIn ? '🟢' : '⚪'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-primary)' }}>Today&apos;s Presence</div>
                  <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>
                    {punchStatus.checkedIn ? 'Checked in' : punchStatus.lastPunch ? 'Checked out' : 'Not punched in yet'}
                    {punchStatus.lastPunch && <> · {fmtTime(punchStatus.lastPunch.time)}</>}
                  </div>
                </div>
                <a href="/ess" style={{ fontSize: 9.5, fontWeight: 700, color: BRAND, textDecoration: 'none', flexShrink: 0 }}>Punch on Home →</a>
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
}
