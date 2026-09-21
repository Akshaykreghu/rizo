'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

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
// - Authorizer/Approver are searchable dropdowns backed by /api/leave/authorizers (which wraps
//   leave_auth_apr_person_fn) — that function can return several eligible emp_pkeys as a comma
//   list, matching legacy's addeditleave_new.ctp where Approve By is a select2-searchable dropdown
//   (Authorize By a searchable typeahead) rather than a single fixed person.
// - No inline "Pending Approvals" section — that's the dedicated Approvals page; duplicating it
//   here would just be the same data in two places.

const BRAND = '#1E516E';
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(d?: string | null) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtMonth(m: string) { const [y, mo] = m.split('-'); return `${MONTHS_SHORT[parseInt(mo) - 1]} ${y}`; }
function fmtMins(mins?: number | null) { if (!mins) return '—'; const h = Math.floor(mins / 60), rm = mins % 60; return h > 0 ? `${h}h ${rm}m` : `${rm}m`; }
function tenureStr(from: string) {
  const s = new Date(from), e = new Date();
  const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  const y = Math.floor(months / 12), m = months % 12;
  return y > 0 ? `${y}y ${m}m` : `${m}m`;
}
function halfLabel(h?: number | null) { return h === 1 ? 'First Half' : h === 2 ? 'Second Half' : '—'; }
function fmtTime(t?: string | null) {
  if (!t) return '—';
  const dt = new Date(t);
  if (!isNaN(dt.getTime())) return dt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  return String(t);
}
const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  P: { label: 'Present', color: '#16a34a', bg: '#f0fdf4' },
  A: { label: 'Absent', color: '#dc2626', bg: '#fef2f2' },
  WO: { label: 'Weekend', color: '#94a3b8', bg: '#f1f5f9' },
  HO: { label: 'Holiday', color: '#7c3aed', bg: '#f5f3ff' },
  NA: { label: 'Not processed', color: '#94a3b8', bg: '#f8fafc' },
  LOP: { label: 'LOP', color: '#b91c1c', bg: '#fef2f2' },
};
function cfgFor(status: string | null) {
  if (!status) return { label: 'No data', color: '#cbd5e1', bg: '#f8fafc' };
  return STATUS_CFG[status] || { label: status, color: '#d97706', bg: '#fffbeb' };
}

// ── Attendance bar chart ──────────────────────────────────────────────────────
function AttendanceBarsChart({ months }: { months: { month: string; present: number; absent: number; leave_days: number }[] }) {
  if (!months.some((m) => m.present || m.absent)) return <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No processed attendance data yet</div>;
  const W = 400, H = 200, PL = 24, PR = 4, PT = 10, PB = 24;
  const cW = W - PL - PR, cH = H - PT - PB;
  const maxPresent = Math.max(...months.map((m) => m.present), 5);
  const n = months.length;
  const slotW = cW / n;
  const barW = Math.max(6, slotW - 6);
  const yMax = Math.ceil(maxPresent / 5) * 5 || 25;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }}>
      {[0, yMax / 2, yMax].map((v) => {
        const y = PT + cH - (v / yMax) * cH;
        return <g key={v}><line x1={PL} x2={W - PR} y1={y} y2={y} stroke="var(--border)" strokeWidth={0.5} strokeDasharray="3,3" /><text x={PL - 3} y={y + 3} fontSize={6.5} textAnchor="end" fill="var(--text-muted)">{Math.round(v)}</text></g>;
      })}
      {months.map((m, i) => {
        const total = m.present + m.absent;
        const pct = total > 0 ? m.present / total : 0;
        const color = total === 0 ? '#e2e8f0' : pct >= 0.9 ? '#16a34a' : pct >= 0.7 ? '#f59e0b' : '#dc2626';
        const barH = (m.present / yMax) * cH;
        const x = PL + i * slotW + (slotW - barW) / 2;
        const y = PT + cH - barH;
        const [, mo] = m.month.split('-');
        return (
          <g key={m.month}>
            <rect x={x} y={y} width={barW} height={Math.max(barH, 1)} fill={color} rx={2} opacity={0.85}><title>{fmtMonth(m.month)}: {m.present} present, {m.absent} absent</title></rect>
            <text x={x + barW / 2} y={H - PB + 11} fontSize={6.5} textAnchor="middle" fill="var(--text-muted)">{MONTHS_SHORT[parseInt(mo) - 1]}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Daily working hours chart ─────────────────────────────────────────────────
function WorkingHoursChart({ days, fullDayMins, halfDayMins }: { days: DayCell[]; fullDayMins: number; halfDayMins: number }) {
  const workDays = days.filter((d) => d.status && d.status !== 'WO' && d.status !== 'HO');
  if (!workDays.length) return <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No data</div>;

  const W = 400, H = 200, PL = 26, PR = 4, PT = 10, PB = 24;
  const cW = W - PL - PR, cH = H - PT - PB;
  const fullH = fullDayMins / 60;
  const halfH = halfDayMins / 60;
  const yMax = Math.max(fullH * 1.3, 10);
  const n = workDays.length;
  const slotW = cW / Math.max(n, 1);
  const barW = Math.max(4, slotW - 4);
  const toY = (h: number) => PT + cH - (h / yMax) * cH;
  const yLines = [...new Set([0, halfH, fullH, yMax])];

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, minWidth: Math.max(W, n * 16 + 40) }}>
        {yLines.map((v) => {
          const y = toY(v);
          const isRef = v === fullH || v === halfH;
          const label = v === 0 ? '0' : v === halfH ? `${halfH}h½` : v === fullH ? `${fullH}h` : '';
          return (
            <g key={v}>
              <line x1={PL} x2={W - PR} y1={y} y2={y} stroke={isRef ? (v === fullH ? '#16a34a' : '#f59e0b') : 'var(--border)'} strokeWidth={isRef ? 1 : 0.5} strokeDasharray={isRef ? '4,3' : '3,3'} opacity={isRef ? 0.7 : 1} />
              {label && <text x={PL - 3} y={y + 3} fontSize={6.5} textAnchor="end" fill={isRef ? (v === fullH ? '#16a34a' : '#f59e0b') : 'var(--text-muted)'}>{label}</text>}
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
      <div style={{ display: 'flex', gap: 10, marginTop: 5 }}>
        {[['#16a34a', `Full (${fullH}h)`], ['#f59e0b', `Half (${halfH}h)`], ['#dc2626', 'Short']].map(([c, l]) => (
          <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 8.5, color: 'var(--text-muted)' }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Leave trend chart ─────────────────────────────────────────────────────────
function LeaveTrendChart({ months }: { months: { month: string; leave_days: number }[] }) {
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

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }}>
      <defs>
        <linearGradient id="lgFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d97706" stopOpacity={0.3} />
          <stop offset="100%" stopColor="#d97706" stopOpacity={0.03} />
        </linearGradient>
      </defs>
      <polygon points={polygon} fill="url(#lgFill)" />
      <polyline points={polyline} fill="none" stroke="#d97706" strokeWidth={2} strokeLinejoin="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} fill="#d97706"><title>{fmtMonth(p.m.month)}: {p.m.leave_days} day(s)</title></circle>
          <text x={p.x} y={H - PB + 11} fontSize={7} textAnchor="middle" fill="var(--text-muted)">{p.m.month.slice(5)}</text>
        </g>
      ))}
    </svg>
  );
}

// ── Square month calendar ─────────────────────────────────────────────────────
interface DayCell { date: string; day: number; dow: number; status: string | null; punch_in: string | null; punch_out: string | null; worked_minutes: number | null }

function MonthCalendar({ days, today, onDayClick }: { days: DayCell[]; today: number; onDayClick: (d: DayCell) => void }) {
  const firstDow = days.length ? new Date(days[0].date).getDay() : 0;
  const cells: (DayCell | null)[] = [...Array(firstDow).fill(null), ...days];
  const CELL = 34;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(7, ${CELL}px)`, gap: 3, marginBottom: 4 }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} style={{ width: CELL, textAlign: 'center', fontSize: 9, fontWeight: 800, color: i === 0 || i === 6 ? '#94a3b8' : 'var(--text-muted)' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(7, ${CELL}px)`, gap: 3 }}>
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} style={{ width: CELL, height: CELL }} />;
          const isFuture = cell.day > today;
          const cfg = cfgFor(cell.status);
          const isToday = cell.day === today;
          return (
            <div key={i} onClick={() => !isFuture && onDayClick(cell)} title={`${cell.day} ${DOW_FULL[cell.dow]}: ${isFuture ? 'Upcoming' : cfg.label}`}
              style={{ width: CELL, height: CELL, borderRadius: 6, cursor: isFuture ? 'default' : 'pointer', background: isFuture ? 'transparent' : cfg.bg, border: isToday ? `2px solid ${BRAND}` : isFuture ? '1px dashed var(--border)' : `1px solid ${cfg.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 10, fontWeight: isToday ? 900 : 700, color: isFuture ? 'var(--text-muted)' : cfg.color }}>{cell.day}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 10 }}>
        {['P', 'A', 'WO', 'HO', 'NA'].map((k) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_CFG[k].bg, border: `1px solid ${STATUS_CFG[k].color}44` }} />
            <span style={{ color: 'var(--text-muted)' }}>{STATUS_CFG[k].label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DayDetailModal({ day, onClose }: { day: DayCell; onClose: () => void }) {
  const cfg = cfgFor(day.status);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: 16, width: 340, boxShadow: '0 24px 60px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
        <div style={{ background: cfg.bg, borderBottom: `3px solid ${cfg.color}`, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 10, color: cfg.color, fontWeight: 800, textTransform: 'uppercase' }}>{DOW_FULL[day.dow]}</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)' }}>{day.day} {MONTHS_SHORT[parseInt(day.date.split('-')[1]) - 1]}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--text-muted)', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {[['Check In', fmtTime(day.punch_in)], ['Check Out', fmtTime(day.punch_out)], ['Duration', fmtMins(day.worked_minutes)]].map(([label, val]) => (
            <div key={label} style={{ flex: 1, textAlign: 'center', padding: '10px 8px' }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>{val}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: 14, textAlign: 'center' }}>
          <span style={{ padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 800, color: cfg.color, background: `${cfg.color}18` }}>{cfg.label}</span>
        </div>
      </div>
    </div>
  );
}

// ── Apply leave modal ─────────────────────────────────────────────────────────
interface LeaveType { salaryHeadItemFkey: number; name: string; allowNegative: boolean; maxLeave: number }

function ApplyLeaveModal({ empId, defaultTypeId, onClose, onSaved }: { empId: number; defaultTypeId?: number | null; onClose: () => void; onSaved: () => void }) {
  const [types, setTypes] = useState<LeaveType[]>([]);
  interface PersonOption { empFkey: number; name: string }
  const [authorizerOptions, setAuthorizerOptions] = useState<PersonOption[]>([]);
  const [approverOptions, setApproverOptions] = useState<PersonOption[]>([]);
  const [authorizerFkey, setAuthorizerFkey] = useState('');
  const [approverFkey, setApproverFkey] = useState('');
  const [authorizerQuery, setAuthorizerQuery] = useState('');
  const [approverQuery, setApproverQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ leave_type_id: defaultTypeId ? String(defaultTypeId) : '', from_date: '', from_half: '1', to_date: '', to_half: '2', reason: '', contact_person: '', contact_no: '' });
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetch(`/api/leave/types?employee=${empId}`).then((r) => (r.ok ? r.json() : { data: [] })).then((d) => setTypes(d.data || []));
    fetch(`/api/leave/authorizers?employee=${empId}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setAuthorizerOptions(d.authorizers ?? []);
      setApproverOptions(d.approvers ?? []);
      // Auto-select when there's exactly one eligible candidate, matching legacy's own
      // "count($arr_users2) == 1" auto-fill behaviour — otherwise the employee must pick.
      if (d.authorizers?.length === 1) setAuthorizerFkey(String(d.authorizers[0].empFkey));
      if (d.approvers?.length === 1) setApproverFkey(String(d.approvers[0].empFkey));
    });
  }, [empId]);

  // Ported from addeditleave_new.ctp's validateLeave()'s day-count formula (first day + full middle
  // days + last day, weighted by half-session) — used only to gate submit against balance, per
  // legacy's own "leave_balance < diffDays" check, which fires regardless of ALLOW_NEGETIVE.
  const requestedDays = (() => {
    if (!form.from_date || !form.to_date) return 0;
    const sdt = new Date(form.from_date), edt = new Date(form.to_date);
    if (edt < sdt) return 0;
    const startSess = form.from_half, endSess = form.to_half;
    if (form.from_date === form.to_date) return startSess === '2' || endSess === '1' ? 0.5 : 1;
    const daysBetween = Math.floor((edt.getTime() - sdt.getTime()) / 86400000) + 1;
    let total = startSess === '1' ? 1 : 0.5;
    if (daysBetween > 2) total += daysBetween - 2;
    total += endSess === '2' ? 1 : 0.5;
    return total;
  })();

  // Ported from addeditleave_new.ctp's getLeaveBalance(): re-fetched whenever leave type or From
  // Date changes, so the balance shown reflects the date being applied for, before submitting.
  const [balancePreview, setBalancePreview] = useState<{
    balance: number;
    allowNegative: boolean;
    minServiceOk: boolean;
    minServiceMessage: string | null;
    advanceNoticeOk: boolean;
    advanceNoticeMessage: string | null;
    documentMandatory: boolean;
    remarks: string | null;
  } | null>(null);

  useEffect(() => {
    if (!form.leave_type_id || !form.from_date) {
      setBalancePreview(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/leave/balance-preview?leaveType=${form.leave_type_id}&fromDate=${form.from_date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setBalancePreview(d); });
    return () => { cancelled = true; };
  }, [form.leave_type_id, form.from_date]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (balancePreview && requestedDays > 0 && balancePreview.balance < requestedDays) {
      setError('You do not have enough leave balance');
      return;
    }
    if (balancePreview?.documentMandatory && !file) {
      setError('A supporting document is required for this leave type');
      return;
    }
    if (!authorizerFkey) {
      setError('Please select who should authorize this leave');
      return;
    }
    if (!approverFkey) {
      setError('Please select who should approve this leave');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let fileName: string | undefined;
      let fileType: string | undefined;
      if (file) {
        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
        const uploadBody = await uploadRes.json();
        setUploading(false);
        if (!uploadRes.ok) throw new Error(uploadBody.error || 'Failed to upload document');
        fileName = uploadBody.path;
        fileType = file.type;
      }

      const res = await fetch('/api/leave/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salaryHeadItemFkey: Number(form.leave_type_id), fromDate: form.from_date, fromHalf: Number(form.from_half),
          toDate: form.to_date, toHalf: Number(form.to_half), reason: form.reason, contactNo: form.contact_no, contactPerson: form.contact_person,
          authorizerFkey: Number(authorizerFkey), approverFkey: Number(approverFkey),
          fileName, fileType,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to apply');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply');
    } finally {
      setSaving(false);
    }
  }

  const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, display: 'block' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: 16, width: 540, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ background: `linear-gradient(135deg, #0c1f2c, ${BRAND})`, padding: '16px 20px', borderRadius: '16px 16px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: '#fff' }}>🌴 Apply for Leave</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <form onSubmit={submit} style={{ padding: 20 }}>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Leave Type *</label>
            <select required style={inp} value={form.leave_type_id} onChange={(e) => setForm((f) => ({ ...f, leave_type_id: e.target.value }))}>
              <option value="">-- Select --</option>
              {types.map((t) => <option key={t.salaryHeadItemFkey} value={t.salaryHeadItemFkey}>{t.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            {(['From', 'To'] as const).map((label) => {
              const dk = label === 'From' ? 'from_date' : 'to_date';
              const hk = label === 'From' ? 'from_half' : 'to_half';
              return (
                <div key={label}>
                  <label style={lbl}>{label} Date *</label>
                  <input type="date" required style={{ ...inp, marginBottom: 6 }} value={form[dk]} onChange={(e) => setForm((f) => ({ ...f, [dk]: e.target.value }))} />
                  <select style={inp} value={form[hk]} onChange={(e) => setForm((f) => ({ ...f, [hk]: e.target.value }))}>
                    <option value="1">First Half</option>
                    <option value="2">Second Half</option>
                  </select>
                </div>
              );
            })}
          </div>
          {balancePreview && (
            <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, background: 'var(--bg-page)', border: '1.5px solid var(--border)', fontSize: 12.5 }}>
              <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Available Leave Balance: {balancePreview.balance}</div>
              {!balancePreview.minServiceOk && <div style={{ color: '#dc2626', marginTop: 4 }}>{balancePreview.minServiceMessage}</div>}
              {!balancePreview.advanceNoticeOk && <div style={{ color: '#dc2626', marginTop: 4 }}>{balancePreview.advanceNoticeMessage}</div>}
              {requestedDays > 0 && balancePreview.balance < requestedDays && <div style={{ color: '#dc2626', marginTop: 4 }}>You do not have enough leave balance</div>}
              {balancePreview.remarks && <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{balancePreview.remarks}</div>}
            </div>
          )}
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Reason *</label>
            <input required type="text" style={inp} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Upload File {balancePreview?.documentMandatory && <span style={{ color: '#dc2626' }}>*</span>}</label>
            <input
              type="file"
              required={balancePreview?.documentMandatory}
              style={inp}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={lbl}>Duties Handed To</label>
              <input style={inp} value={form.contact_person} onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Contact During Leave</label>
              <input style={inp} value={form.contact_no} onChange={(e) => setForm((f) => ({ ...f, contact_no: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14, position: 'relative' }}>
            <PersonPicker
              label="Authorize By"
              required
              options={authorizerOptions}
              value={authorizerFkey}
              query={authorizerQuery}
              onQueryChange={setAuthorizerQuery}
              onSelect={setAuthorizerFkey}
              inp={inp}
              lbl={lbl}
            />
            <PersonPicker
              label="Approve By"
              required
              options={approverOptions}
              value={approverFkey}
              query={approverQuery}
              onQueryChange={setApproverQuery}
              onSelect={setApproverFkey}
              inp={inp}
              lbl={lbl}
            />
          </div>
          {error && <div style={{ marginBottom: 12, fontSize: 12, color: '#dc2626' }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            <button type="submit" disabled={saving || !form.leave_type_id || !form.from_date || !form.to_date || !form.reason || !authorizerFkey || !approverFkey || (!!balancePreview && requestedDays > 0 && balancePreview.balance < requestedDays)} style={{ padding: '8px 22px', borderRadius: 8, border: 'none', background: BRAND, color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: 13, opacity: saving ? 0.7 : 1 }}>
              {uploading ? 'Uploading…' : saving ? 'Submitting…' : 'Submit Leave'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Searchable dropdown for Authorize By / Approve By — mirrors legacy's select2-searching behaviour
// (typing filters the candidate list returned by leave_auth_apr_person_fn) rather than a plain
// <select>, since the candidate list can be long depending on the hierarchy configuration.
function PersonPicker({
  label, required, options, value, query, onQueryChange, onSelect, inp, lbl,
}: {
  label: string;
  required?: boolean;
  options: { empFkey: number; name: string }[];
  value: string;
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (empFkey: string) => void;
  inp: React.CSSProperties;
  lbl: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => String(o.empFkey) === value);
  const filtered = query
    ? options.filter((o) => o.name.toLowerCase().includes(query.toLowerCase()))
    : options;

  // The modal body scrolls independently of the page; a plain onBlur close doesn't fire when the
  // user scrolls that body without moving focus away, leaving the dropdown floating over unrelated
  // fields. Closing on any scroll within the modal (capture phase, since the scroll container itself
  // doesn't bubble 'scroll') fixes that.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [open]);

  return (
    <div style={{ position: 'relative' }}>
      <label style={lbl}>{label} {required && <span style={{ color: '#dc2626' }}>*</span>}</label>
      <input
        type="text"
        style={inp}
        placeholder="Search employee…"
        value={open ? query : (selected?.name ?? '')}
        onFocus={() => { onQueryChange(''); setOpen(true); }}
        onChange={(e) => onQueryChange(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 8, maxHeight: 200, overflowY: 'auto', zIndex: 20, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
          {filtered.length === 0 && <div style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--text-muted)' }}>No matches</div>}
          {filtered.map((o) => (
            <div
              key={o.empFkey}
              onMouseDown={() => { onSelect(String(o.empFkey)); setOpen(false); }}
              style={{ padding: '8px 12px', fontSize: 12.5, cursor: 'pointer', background: String(o.empFkey) === value ? `${BRAND}12` : 'transparent', color: 'var(--text-primary)' }}
            >
              {o.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
interface Balance { salaryHeadItemFkey: number; name: string; allowNegative: boolean; maxLeave: number; isLeaveEncash: boolean; balance: number }
interface LeaveRow {
  LEAVEENTRYID: number; leave_type: string; FROMDATE: string; FROMHALF: number; TODATE: string; TOHALF: number;
  leave_days: number; LEAVESTATUS: string; applied_date: string;
  Reason: string | null; contact_person: string | null; contact_No: string | null;
  ISAutherizedby: number | null; Autherized_date: string | null; authorized_by_first_name: string | null; authorized_by_last_name: string | null;
  APPROVEDBY: number | null; APPROVED_date: string | null; approved_by_first_name: string | null; approved_by_last_name: string | null;
  REMARKS: string | null;
}
interface Presence {
  employee: { emp_pkey: number; first_name: string; last_name: string; joining_date: string | null; shift_name: string | null; leave_group_name: string | null };
  shiftInfo: { fullDayMins: number; halfDayMins: number; startTime: string | null; endTime: string | null };
  currentMonth: { month: string; today: number; days: DayCell[] } | null;
  monthlyAttendance: { month: string; present: number; absent: number; leave_days: number }[];
}

const STATUS_TEXT_LABEL: Record<string, string> = {
  CancellationOfAuthorized: 'Cancellation of Authorized',
  CancellationOfApproved: 'Cancellation of Approved',
  CancelledByAdmin: 'Cancelled by Admin',
  'Can not Apply 0 days': 'Rejected — No Leave Days Available',
};

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, [string, string]> = {
    Applied: [BRAND, '#e0f2fe'], Authorized: ['#7c3aed', '#f5f3ff'], Approved: ['#16a34a', '#f0fdf4'],
    Rejected: ['#dc2626', '#fef2f2'], Cancelled: ['#94a3b8', '#f1f5f9'], CancelledByAdmin: ['#94a3b8', '#f1f5f9'],
    CancellationOfAuthorized: ['#b45309', '#fffbeb'], CancellationOfApproved: ['#b45309', '#fffbeb'],
    'Can not Apply 0 days': ['#dc2626', '#fef2f2'],
  };
  const [color, bg] = cfg[status] || [BRAND, '#e0f2fe'];
  return <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color, background: bg }}>{STATUS_TEXT_LABEL[status] ?? status}</span>;
}

const STATUS_STRIPE: Record<string, string> = {
  Applied: BRAND, Authorized: '#7c3aed', Approved: '#16a34a', Rejected: '#dc2626', Cancelled: '#94a3b8',
  CancelledByAdmin: '#94a3b8', CancellationOfAuthorized: '#b45309', CancellationOfApproved: '#b45309',
  'Can not Apply 0 days': '#dc2626',
};

const leaveDetailSec: React.CSSProperties = { padding: '14px 20px', borderBottom: '1px solid var(--border)' };
const leaveDetailSecLabel: React.CSSProperties = { fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: 8 };
function LeaveInfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 5, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, minWidth: 130, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--text-primary)' }}>{value || '—'}</span>
    </div>
  );
}

interface LeaveDetails {
  leaveType: string;
  leaveBalance: number;
  allowNegative: boolean;
  isSandwich: boolean;
  reason: string | null;
  status: string;
  transactions: { leaveDate: string; status: string; remarks: string | null }[];
  documents: { name: string; type: string }[];
}

function LeaveDetailModal({ leave: r, onClose }: { leave: LeaveRow; onClose: () => void }) {
  const [details, setDetails] = useState<LeaveDetails | null>(null);
  const [docName, setDocName] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [savingDoc, setSavingDoc] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  const loadDetails = useCallback(() => {
    fetch(`/api/leave/requests/${r.LEAVEENTRYID}/details`).then((res) => (res.ok ? res.json() : null)).then(setDetails);
  }, [r.LEAVEENTRYID]);

  useEffect(() => { loadDetails(); }, [loadDetails]);

  async function handleSaveDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!docFile) return;
    setSavingDoc(true);
    setDocError(null);
    try {
      const formData = new FormData();
      formData.append('file', docFile);
      const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
      const uploadBody = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadBody.error || 'Failed to upload document');

      const saveRes = await fetch(`/api/leave/requests/${r.LEAVEENTRYID}/document`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: uploadBody.path, displayName: docName || docFile.name }),
      });
      if (!saveRes.ok) throw new Error((await saveRes.json()).error || 'Failed to save document');

      setDocName('');
      setDocFile(null);
      loadDetails();
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Failed to save document');
    } finally {
      setSavingDoc(false);
    }
  }

  const sec = leaveDetailSec;
  const secLabel = leaveDetailSecLabel;
  const authorizedByName = r.authorized_by_first_name ? `${r.authorized_by_first_name} ${r.authorized_by_last_name || ''}`.trim() : null;
  const approvedByName = r.approved_by_first_name ? `${r.approved_by_first_name} ${r.approved_by_last_name || ''}`.trim() : null;
  const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)', fontSize: 12.5, outline: 'none', boxSizing: 'border-box' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: 18, width: 480, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ background: `linear-gradient(135deg, #0c1f2c, ${BRAND})`, padding: '16px 20px', borderRadius: '18px 18px 0 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#fff', marginBottom: 4 }}>🌴 {r.leave_type || 'Leave Request'}</div>
            <StatusBadge status={r.LEAVESTATUS} />
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1, marginTop: 2 }}>×</button>
        </div>

        {details && (
          <div style={sec}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5 }}>
              <span><strong style={{ color: 'var(--text-primary)' }}>Leave Balance:</strong> {details.leaveBalance}</span>
              <span><strong style={{ color: 'var(--text-primary)' }}>Negative:</strong> {details.allowNegative ? 'Yes' : 'No'}</span>
              <span><strong style={{ color: 'var(--text-primary)' }}>Sandwich:</strong> {details.isSandwich ? 'Yes' : 'No'}</span>
            </div>
          </div>
        )}

        <div style={sec}>
          <div style={secLabel}>Duration</div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>From</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{fmtDate(r.FROMDATE)}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{halfLabel(r.FROMHALF)}</div>
            </div>
            <div style={{ fontSize: 18, color: 'var(--text-muted)', fontWeight: 300 }}>→</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>To</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{fmtDate(r.TODATE)}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{halfLabel(r.TOHALF)}</div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'center', padding: '8px 16px', borderRadius: 10, background: `${BRAND}12`, border: `1px solid ${BRAND}33` }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: BRAND, lineHeight: 1 }}>{r.leave_days}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>day{r.leave_days !== 1 ? 's' : ''}</div>
            </div>
          </div>
        </div>

        <div style={sec}>
          <div style={secLabel}>Details</div>
          <LeaveInfoRow label="Reason" value={r.Reason} />
          {r.contact_person && <LeaveInfoRow label="Duties Handed To" value={r.contact_person} />}
          {r.contact_No && <LeaveInfoRow label="Contact During Leave" value={r.contact_No} />}
        </div>

        <div style={sec}>
          <div style={secLabel}>Approval Chain</div>
          <LeaveInfoRow label="Applied On" value={fmtDate(r.applied_date)} />
          <LeaveInfoRow
            label="Authorized By"
            value={authorizedByName ? `${authorizedByName}${r.Autherized_date ? ' · ' + fmtDate(r.Autherized_date) : ''}` : (r.LEAVESTATUS === 'Applied' ? 'Pending' : '—')}
          />
          <LeaveInfoRow
            label="Approved By"
            value={approvedByName ? `${approvedByName}${r.APPROVED_date ? ' · ' + fmtDate(r.APPROVED_date) : ''}` : (r.LEAVESTATUS === 'Authorized' || r.LEAVESTATUS === 'Applied' ? 'Pending' : '—')}
          />
          {r.LEAVESTATUS === 'Rejected' && r.REMARKS && (
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #dc262622' }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: '#dc2626', textTransform: 'uppercase', marginBottom: 3 }}>Rejection Remarks</div>
              <div style={{ fontSize: 11, color: '#dc2626' }}>{r.REMARKS}</div>
            </div>
          )}
        </div>

        {details && details.transactions.length > 0 && (
          <div style={sec}>
            <div style={secLabel}>Leave Days</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '4px 0', fontWeight: 700 }}>Date</th>
                  <th style={{ padding: '4px 0', fontWeight: 700 }}>Status</th>
                  <th style={{ padding: '4px 0', fontWeight: 700 }}>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {details.transactions.map((t, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '4px 0', color: 'var(--text-primary)' }}>{fmtDate(t.leaveDate)}</td>
                    <td style={{ padding: '4px 0', color: 'var(--text-primary)' }}>{t.status}</td>
                    <td style={{ padding: '4px 0', color: 'var(--text-muted)' }}>{t.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={sec}>
          <div style={secLabel}>Documents</div>
          {details && details.documents.length > 0 ? (
            <div style={{ marginBottom: 10 }}>
              {details.documents.map((d, i) => (
                <div key={i} style={{ fontSize: 11, color: 'var(--text-primary)', marginBottom: 3 }}>
                  📎 <a href={d.name} target="_blank" rel="noreferrer" style={{ color: BRAND }}>{d.type || d.name}</a>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>No documents uploaded yet</div>
          )}
          <form onSubmit={handleSaveDocument} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>Document Name</label>
              <input type="text" style={inp} value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="Uploaded File Name" />
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>Upload Document</label>
              <input type="file" style={inp} onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
            </div>
            <button type="submit" disabled={!docFile || savingDoc} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: BRAND, color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: 12, opacity: savingDoc || !docFile ? 0.6 : 1 }}>
              {savingDoc ? 'Saving…' : 'Save'}
            </button>
          </form>
          {docError && <div style={{ marginTop: 6, fontSize: 11, color: '#dc2626' }}>{docError}</div>}
        </div>

        <div style={{ padding: '14px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function EssPresencePage() {
  const { data: session } = useSession();
  const empId = session?.user.empFkey;

  const [presence, setPresence] = useState<Presence | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyType, setApplyType] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<DayCell | null>(null);
  const [selectedLeaveRequest, setSelectedLeaveRequest] = useState<LeaveRow | null>(null);
  const [selectedLeaveIds, setSelectedLeaveIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);

  const nowMonth = new Date().toISOString().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(nowMonth);

  const load = useCallback(() => {
    if (!empId) return;
    Promise.all([
      fetch(`/api/employees/${empId}/presence-summary?month=${selectedMonth}`).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/leave/balances').then((r) => (r.ok ? r.json() : { data: [] })),
      fetch('/api/leave/requests').then((r) => (r.ok ? r.json() : { data: [] })),
    ]).then(([p, b, l]) => {
      setPresence(p);
      setBalances(b.data || []);
      setLeaves(l.data || []);
    }).finally(() => setLoading(false));
  }, [empId, selectedMonth]);

  useEffect(() => { load(); }, [load]);

  // Status gate for the Remove option — extends legacy's index.ctp "Remove" handler
  // (Approved/Authorized/CancellationOfApproved) with CancellationOfAuthorized by product decision,
  // since a leave already pending cancellation review shouldn't be independently deletable either.
  const isLeaveDeletable = (r: LeaveRow) =>
    !['Approved', 'Authorized', 'CancellationOfApproved', 'CancellationOfAuthorized'].includes(r.LEAVESTATUS);

  // Ported from addeditleave_new.ctp's cancelLeave() button visibility — Applied cancels
  // immediately, Authorized/Approved raise a pending-review cancellation instead.
  const isLeaveCancellable = (r: LeaveRow) => ['Applied', 'Authorized', 'Approved'].includes(r.LEAVESTATUS);

  const [cancellingId, setCancellingId] = useState<number | null>(null);

  async function cancelLeaveRow(id: number) {
    if (!confirm('Really you want to cancel leave?')) return;
    setCancellingId(id);
    try {
      const res = await fetch(`/api/leave/requests/${id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to cancel leave');
      alert(body.requiresReview ? 'Cancellation request submitted — pending approval.' : 'Leave cancelled.');
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel leave');
    } finally {
      setCancellingId(null);
    }
  }

  function toggleLeaveSelect(id: number) {
    setSelectedLeaveIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function deleteSelectedLeaves() {
    if (selectedLeaveIds.size === 0) return;
    if (!confirm('Delete the selected leave request(s)?')) return;
    setDeleting(true);
    setDeleteResult(null);
    try {
      const res = await fetch('/api/leave/requests/bulk-delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedLeaveIds] }),
      });
      const body = await res.json() as { deleted: number[]; skipped: { id: number; reason: string }[] };

      // A row can still get skipped even though the checkbox only shows for deletable rows — its
      // status may have changed (e.g. someone approved it) between page load and this click.
      // Reporting deleted/skipped honestly here, rather than a blanket "removed", matches what
      // actually happened instead of implying every selected row was removed.
      if (body.skipped.length === 0) {
        setDeleteResult(`${body.deleted.length} leave request(s) removed`);
      } else if (body.deleted.length === 0) {
        setDeleteResult(`None removed — ${body.skipped.map((s) => s.reason).join('; ')}`);
      } else {
        setDeleteResult(`${body.deleted.length} removed, ${body.skipped.length} skipped (${body.skipped.map((s) => s.reason).join('; ')})`);
      }

      setSelectedLeaveIds(new Set());
      load();
    } finally {
      setDeleting(false);
    }
  }

  if (loading || !presence) {
    return (
      <div style={{ height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: BRAND, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  const { employee: emp, shiftInfo, currentMonth, monthlyAttendance } = presence;

  const avgAtt = monthlyAttendance.length
    ? Math.round(monthlyAttendance.reduce((s, m) => s + (m.present / Math.max(m.present + m.absent, 1)) * 100, 0) / monthlyAttendance.length)
    : 0;
  const totalLeavesTaken = monthlyAttendance.reduce((s, m) => s + m.leave_days, 0);
  const bestMonth = monthlyAttendance.length ? [...monthlyAttendance].sort((a, b) => b.present - a.present)[0] : null;
  const totalPresent = monthlyAttendance.reduce((s, m) => s + m.present, 0);

  // Derived (not fabricated) from currentMonth.days — the API doesn't precompute working-days /
  // days-remaining fields the way New Rizo's backend does, but they're a straight read of the
  // same day array New Rizo's own backend would have used to compute them.
  const cmDays = currentMonth?.days ?? [];
  const cmToday = currentMonth?.today ?? 0;
  const elapsedDays = cmDays.filter((d) => d.day <= cmToday);
  const cmData = {
    present: elapsedDays.filter((d) => d.status === 'P').length,
    absent: elapsedDays.filter((d) => d.status === 'A' || (d.status?.includes('LOP') ?? false)).length,
    leave: elapsedDays.filter((d) => d.status && d.status !== 'P' && d.status !== 'A' && d.status !== 'WO' && d.status !== 'HO' && d.status !== 'NA' && !d.status.includes('LOP')).length,
    holiday: cmDays.filter((d) => d.status === 'HO').length,
  };
  const workingDays = cmDays.filter((d) => d.status !== 'WO' && d.status !== 'HO').length;
  const daysRemaining = Math.max(cmDays.length - cmToday, 0);

  return (
    <div style={{ background: 'var(--bg-page)', minHeight: '100%' }}>
      <div style={{ background: `linear-gradient(135deg, #0c1f2c 0%, ${BRAND} 55%, #2d7fb8 100%)`, padding: '18px 28px 16px' }}>
        <div style={{ maxWidth: 1300, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 900, color: '#fff', marginBottom: 6 }}>📊 My Presence</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', alignItems: 'center' }}>
                {emp.joining_date && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>Joined <strong style={{ color: '#fff' }}>{fmtDate(emp.joining_date)}</strong> · {tenureStr(emp.joining_date)} tenure</span>}
                {emp.shift_name && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>⏰ Shift: <strong style={{ color: '#fff' }}>{emp.shift_name}</strong>{shiftInfo.startTime && <span style={{ color: 'rgba(255,255,255,0.6)' }}> ({fmtTime(shiftInfo.startTime)} – {fmtTime(shiftInfo.endTime)})</span>}</span>}
                {emp.leave_group_name && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>🌴 Policy: <strong style={{ color: '#fff' }}>{emp.leave_group_name}</strong></span>}
                {monthlyAttendance.length > 0 && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>Avg attendance: <strong style={{ color: avgAtt >= 90 ? '#86efac' : avgAtt >= 70 ? '#fde68a' : '#fca5a5' }}>{avgAtt}%</strong></span>}
                {currentMonth && selectedMonth === nowMonth && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}><strong style={{ color: '#fff' }}>{daysRemaining} days remaining</strong> · {workingDays} working days</span>}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.12)', borderRadius: 10, padding: '6px 12px', border: '1px solid rgba(255,255,255,0.2)' }}>
              <button
                onClick={() => { const [y, m] = selectedMonth.split('-').map(Number); const d = new Date(y, m - 2, 1); setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', fontSize: 16, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
              >‹</button>
              <input
                type="month"
                value={selectedMonth}
                max={nowMonth}
                onChange={(e) => e.target.value && setSelectedMonth(e.target.value)}
                style={{ background: 'none', border: 'none', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', outline: 'none', colorScheme: 'dark' }}
              />
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

      {monthlyAttendance.length > 0 && bestMonth && (
        <div style={{ background: `${BRAND}0a`, borderBottom: '1px solid var(--border)', padding: '8px 28px' }}>
          <div style={{ maxWidth: 1300, margin: '0 auto', fontSize: 11, color: 'var(--text-muted)' }}>
            Since joining — {totalPresent} days present across {monthlyAttendance.length} month{monthlyAttendance.length !== 1 ? 's' : ''} · {totalLeavesTaken} leave day{totalLeavesTaken !== 1 ? 's' : ''} taken · Best month: {fmtMonth(bestMonth.month)} ({bestMonth.present} days present)
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '20px 28px 48px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          {[
            { label: 'Present', val: cmData.present, color: '#16a34a', bg: '#f0fdf4' },
            { label: 'Absent', val: cmData.absent, color: '#dc2626', bg: '#fef2f2' },
            { label: 'On Leave', val: cmData.leave, color: '#d97706', bg: '#fffbeb' },
            { label: 'Holidays', val: cmData.holiday, color: '#7c3aed', bg: '#f5f3ff' },
          ].map((s) => (
            <div key={s.label} style={{ background: s.bg, border: `1.5px solid ${s.color}22`, borderRadius: 16, padding: '12px 16px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: s.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: s.color, lineHeight: 1.2, marginTop: 2 }}>{s.val}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>This month</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, minWidth: 0 }}>
          <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, padding: '12px 14px', minWidth: 0 }}>
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)' }}>Attendance Trend</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Present days / month</div>
            </div>
            <AttendanceBarsChart months={monthlyAttendance} />
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, padding: '12px 14px', minWidth: 0 }}>
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)' }}>Daily Working Hours</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Logged vs full ({shiftInfo.fullDayMins / 60}h) / half ({shiftInfo.halfDayMins / 60}h) day</div>
            </div>
            {currentMonth
              ? <WorkingHoursChart days={currentMonth.days} fullDayMins={shiftInfo.fullDayMins} halfDayMins={shiftInfo.halfDayMins} />
              : <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>No data</div>}
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, padding: '12px 14px', minWidth: 0 }}>
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)' }}>Leave Trend</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Leave days taken per month</div>
            </div>
            {monthlyAttendance.some((m) => m.leave_days > 0)
              ? <LeaveTrendChart months={monthlyAttendance} />
              : <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text-muted)' }}>No leave days recorded</div>}
          </div>
        </div>

        <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>{currentMonth ? `${fmtMonth(currentMonth.month)} — Day by Day` : 'Current Month'}</div>
            {currentMonth && (
              <div style={{ display: 'flex', gap: 16 }}>
                {[['Working Days', workingDays], ['Days Elapsed', cmToday], ['Remaining', daysRemaining]].map(([label, val]) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: BRAND }}>{val}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10 }}>Click any day to see check-in / check-out details</div>
          {currentMonth ? (
            <MonthCalendar days={currentMonth.days} today={currentMonth.today} onDayClick={setSelectedDay} />
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Attendance for this month hasn&apos;t been processed yet</div>
          )}
        </div>

        {balances.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>🌴 Leave Balances</div>
              <button onClick={() => { setApplyType(null); setApplyOpen(true); }} style={{ padding: '6px 16px', borderRadius: 20, background: BRAND, color: '#fff', border: 'none', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>+ Apply Leave</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
              {balances.map((b) => (
                <div key={b.salaryHeadItemFkey} style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 14, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{b.name}</div>
                    <span style={{ fontSize: 26, fontWeight: 900, color: b.balance >= 0 ? BRAND : '#dc2626' }}>{b.balance}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                    {b.maxLeave > 0 && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: `${BRAND}12`, color: BRAND }}>Max {b.maxLeave}/yr</span>}
                    {b.isLeaveEncash && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#ecfeff', color: '#0891b2' }}>Encashable</span>}
                  </div>
                  <button onClick={() => { setApplyType(b.salaryHeadItemFkey); setApplyOpen(true); }} style={{ width: '100%', padding: '7px 12px', borderRadius: 8, border: `1.5px solid ${BRAND}`, background: 'transparent', color: BRAND, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>+ Apply {b.name}</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px 10px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>My Leave Requests</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Click any row to view full details</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {selectedLeaveIds.size > 0 && (
                <button
                  onClick={deleteSelectedLeaves}
                  disabled={deleting}
                  style={{ fontSize: 11, fontWeight: 800, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 20, padding: '4px 12px', cursor: 'pointer', opacity: deleting ? 0.6 : 1 }}
                >
                  {deleting ? 'Deleting…' : `Delete (${selectedLeaveIds.size})`}
                </button>
              )}
              <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-page)', padding: '2px 8px', borderRadius: 10, border: '1px solid var(--border)' }}>{leaves.length} total</span>
            </div>
          </div>
          {deleteResult && (
            <div style={{ padding: '8px 18px', fontSize: 11, color: 'var(--text-primary)', background: 'var(--bg-page)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{deleteResult}</span>
              <button onClick={() => setDeleteResult(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}>Dismiss</button>
            </div>
          )}
          {leaves.length === 0 ? (
            <div style={{ padding: '24px 18px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>No leave requests yet</div>
          ) : (
            <div>
              {leaves.slice(0, 10).map((r) => (
                <div
                  key={r.LEAVEENTRYID}
                  onClick={() => setSelectedLeaveRequest(r)}
                  style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}
                >
                  {isLeaveDeletable(r) ? (
                    <input
                      type="checkbox"
                      checked={selectedLeaveIds.has(r.LEAVEENTRYID)}
                      onChange={() => toggleLeaveSelect(r.LEAVEENTRYID)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ marginTop: 3, flexShrink: 0 }}
                    />
                  ) : (
                    <div style={{ width: 13, flexShrink: 0 }} />
                  )}
                  <div style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: STATUS_STRIPE[r.LEAVESTATUS] || BRAND, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>{r.leave_type}</span>
                      <StatusBadge status={r.LEAVESTATUS} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {fmtDate(r.FROMDATE)}{r.FROMHALF ? <span style={{ fontSize: 9, marginLeft: 3 }}>({halfLabel(r.FROMHALF)})</span> : null}
                      {' → '}
                      {fmtDate(r.TODATE)}{r.TOHALF ? <span style={{ fontSize: 9, marginLeft: 3 }}>({halfLabel(r.TOHALF)})</span> : null}
                      {' · '}<strong style={{ color: 'var(--text-primary)' }}>{r.leave_days}d</strong>
                    </div>
                    {r.Reason && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.Reason}</div>}
                  </div>
                  {isLeaveCancellable(r) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); cancelLeaveRow(r.LEAVEENTRYID); }}
                      disabled={cancellingId === r.LEAVEENTRYID}
                      style={{ fontSize: 10, fontWeight: 800, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 20, padding: '3px 10px', cursor: 'pointer', flexShrink: 0, alignSelf: 'center', opacity: cancellingId === r.LEAVEENTRYID ? 0.6 : 1 }}
                    >
                      {cancellingId === r.LEAVEENTRYID ? 'Cancelling…' : 'Cancel'}
                    </button>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, alignSelf: 'center' }}>›</div>
                </div>
              ))}
              {leaves.length > 10 && (
                <div style={{ padding: '10px 18px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', borderTop: '1px solid var(--border)' }}>Showing 10 of {leaves.length} requests</div>
              )}
            </div>
          )}
        </div>
      </div>

      {applyOpen && empId && <ApplyLeaveModal empId={empId} defaultTypeId={applyType} onClose={() => setApplyOpen(false)} onSaved={() => { setApplyOpen(false); load(); }} />}
      {selectedDay && <DayDetailModal day={selectedDay} onClose={() => setSelectedDay(null)} />}
      {selectedLeaveRequest && (
        <LeaveDetailModal
          leave={selectedLeaveRequest}
          onClose={() => setSelectedLeaveRequest(null)}
        />
      )}
    </div>
  );
}
