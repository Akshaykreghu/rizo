'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

// Port of New Rizo's pages/ESS/ESSPresence.jsx, backed by /api/employees/[id]/presence-summary
// (new — see that route's comment) and the already self-scoped leave/* routes. Simplifications
// versus the original, driven by what the real data actually contains:
// - Leave balance cards show only the final balance (leave_balance_inthe_year_fn / _month_fn) —
//   lib/leave.ts's getLeaveBalance never computed an opening/credited/taken breakdown, so New
//   Rizo's 4-stat card isn't reconstructable from real data.
// - No shift-override control on the day-detail popup — that's an admin/payroll concern
//   (PUT /api/attendance/daily-shift doesn't exist here), so the popup is read-only.
// - Authorizer/Approver are shown read-only (auto-resolved via /api/leave/authorizers from the
//   real reporting hierarchy) rather than manual dropdowns, matching the same choice made for
//   Requests/Approvals.

const BRAND = '#1E516E';
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(d?: string | null) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtMonth(m: string) { const [y, mo] = m.split('-'); return `${MONTHS_SHORT[parseInt(mo) - 1]} ${y}`; }
function fmtMins(mins?: number | null) { if (!mins) return '—'; const h = Math.floor(mins / 60), rm = mins % 60; return h > 0 ? `${h}h ${rm}m` : `${rm}m`; }
function fmtTime(t?: string | null) {
  if (!t) return '—';
  const dt = new Date(t);
  if (!isNaN(dt.getTime())) return dt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  return String(t);
}
function calcLeaveDays(from: string, fromHalf: number, to: string, toHalf: number) {
  if (!from || !to) return 0;
  let days = 0;
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) {
      const ds = cur.toISOString().split('T')[0];
      const isFirst = ds === from, isLast = ds === to;
      if (isFirst && isLast) days += (fromHalf === 2 || toHalf === 1) ? 0.5 : 1;
      else if (isFirst && fromHalf === 2) days += 0.5;
      else if (isLast && toHalf === 1) days += 0.5;
      else days += 1;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return days;
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
  const [approvers, setApprovers] = useState<{ authorizer: { name: string | null } | null; approver: { name: string | null } | null }>({ authorizer: null, approver: null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ leave_type_id: defaultTypeId ? String(defaultTypeId) : '', from_date: '', from_half: '1', to_date: '', to_half: '2', reason: '', contact_person: '', contact_no: '' });

  useEffect(() => {
    fetch(`/api/leave/types?employee=${empId}`).then((r) => (r.ok ? r.json() : { data: [] })).then((d) => setTypes(d.data || []));
    fetch(`/api/leave/authorizers?employee=${empId}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setApprovers(d));
  }, [empId]);

  const leaveDays = calcLeaveDays(form.from_date, Number(form.from_half), form.to_date, Number(form.to_half));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/leave/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salaryHeadItemFkey: Number(form.leave_type_id), fromDate: form.from_date, fromHalf: Number(form.from_half),
          toDate: form.to_date, toHalf: Number(form.to_half), reason: form.reason, contactNo: form.contact_no, contactPerson: form.contact_person,
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
          {leaveDays > 0 && <div style={{ marginBottom: 14, padding: '8px 14px', borderRadius: 8, background: `${BRAND}12`, border: `1px solid ${BRAND}33`, fontSize: 13, fontWeight: 700, color: BRAND }}>📅 {leaveDays} day{leaveDays !== 1 ? 's' : ''}</div>}
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Reason *</label>
            <input required type="text" style={inp} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
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
          <div style={{ display: 'flex', gap: 16, marginBottom: 14, fontSize: 12, color: 'var(--text-muted)' }}>
            <span>Authorizer: <strong style={{ color: 'var(--text-primary)' }}>{approvers.authorizer?.name || 'Not configured'}</strong></span>
            <span>Approver: <strong style={{ color: 'var(--text-primary)' }}>{approvers.approver?.name || 'Not configured'}</strong></span>
          </div>
          {error && <div style={{ marginBottom: 12, fontSize: 12, color: '#dc2626' }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            <button type="submit" disabled={saving || !form.leave_type_id || !form.from_date || !form.to_date || !form.reason} style={{ padding: '8px 22px', borderRadius: 8, border: 'none', background: BRAND, color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: 13, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Submitting…' : 'Submit Leave'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
interface Balance { salaryHeadItemFkey: number; name: string; allowNegative: boolean; maxLeave: number; isLeaveEncash: boolean; balance: number }
interface LeaveRow { LEAVEENTRYID: number; leave_type: string; FROMDATE: string; TODATE: string; leave_days: number; LEAVESTATUS: string; applied_date: string }
interface Presence {
  employee: { emp_pkey: number; first_name: string; last_name: string; joining_date: string | null; shift_name: string | null; leave_group_name: string | null };
  shiftInfo: { fullDayMins: number; halfDayMins: number; startTime: string | null; endTime: string | null };
  currentMonth: { month: string; today: number; days: DayCell[] } | null;
  monthlyAttendance: { month: string; present: number; absent: number; leave_days: number }[];
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, [string, string]> = { Applied: [BRAND, '#e0f2fe'], Authorized: ['#7c3aed', '#f5f3ff'], Approved: ['#16a34a', '#f0fdf4'], Rejected: ['#dc2626', '#fef2f2'], Cancelled: ['#94a3b8', '#f1f5f9'] };
  const [color, bg] = cfg[status] || [BRAND, '#e0f2fe'];
  return <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color, background: bg }}>{status}</span>;
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

  const load = useCallback(() => {
    if (!empId) return;
    Promise.all([
      fetch(`/api/employees/${empId}/presence-summary`).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/leave/balances').then((r) => (r.ok ? r.json() : { data: [] })),
      fetch('/api/leave/requests').then((r) => (r.ok ? r.json() : { data: [] })),
    ]).then(([p, b, l]) => {
      setPresence(p);
      setBalances(b.data || []);
      setLeaves(l.data || []);
    }).finally(() => setLoading(false));
  }, [empId]);

  useEffect(() => { load(); }, [load]);

  async function cancelLeave(id: number) {
    if (!confirm('Cancel this leave request?')) return;
    await fetch(`/api/leave/requests/${id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    load();
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

  return (
    <div style={{ background: 'var(--bg-page)', minHeight: '100%' }}>
      <div style={{ background: `linear-gradient(135deg, #0c1f2c 0%, ${BRAND} 55%, #2d7fb8 100%)`, padding: '18px 28px 16px' }}>
        <div style={{ maxWidth: 1300, margin: '0 auto' }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#fff', marginBottom: 6 }}>📊 My Presence</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px' }}>
            {emp.joining_date && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>Joined <strong style={{ color: '#fff' }}>{fmtDate(emp.joining_date)}</strong></span>}
            {emp.shift_name && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>⏰ Shift: <strong style={{ color: '#fff' }}>{emp.shift_name}</strong>{shiftInfo.startTime && <span style={{ color: 'rgba(255,255,255,0.6)' }}> ({fmtTime(shiftInfo.startTime)} – {fmtTime(shiftInfo.endTime)})</span>}</span>}
            {emp.leave_group_name && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>🌴 Policy: <strong style={{ color: '#fff' }}>{emp.leave_group_name}</strong></span>}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '20px 28px 48px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>Attendance — last 12 months</div>
            <AttendanceBarsChart months={monthlyAttendance} />
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 16, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>{currentMonth ? `Calendar — ${fmtMonth(currentMonth.month)}` : 'Calendar'}</div>
            {currentMonth ? (
              <MonthCalendar days={currentMonth.days} today={currentMonth.today} onDayClick={setSelectedDay} />
            ) : (
              <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>Attendance for this month hasn&apos;t been processed yet</div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>🌴 Leave Balance</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 24 }}>
          {balances.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 20 }}>No leave policy assigned</div>
          ) : balances.map((b) => (
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

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>📋 My Leave History</div>
          <button onClick={() => { setApplyType(null); setApplyOpen(true); }} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: BRAND, color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>+ Apply Leave</button>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Leave Type', 'From', 'To', 'Days', 'Status', 'Applied On', ''].map((h) => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', background: 'var(--bg-page)' }}>{h}</th>)}</tr></thead>
              <tbody>
                {leaves.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No leave history</td></tr>
                ) : leaves.map((r) => (
                  <tr key={r.LEAVEENTRYID}>
                    <td style={{ padding: '10px 14px', fontSize: 13, borderBottom: '1px solid var(--border)' }}>{r.leave_type}</td>
                    <td style={{ padding: '10px 14px', fontSize: 13, borderBottom: '1px solid var(--border)' }}>{fmtDate(r.FROMDATE)}</td>
                    <td style={{ padding: '10px 14px', fontSize: 13, borderBottom: '1px solid var(--border)' }}>{fmtDate(r.TODATE)}</td>
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, borderBottom: '1px solid var(--border)' }}>{r.leave_days}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}><StatusBadge status={r.LEAVESTATUS} /></td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>{fmtDate(r.applied_date)}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                      {r.LEAVESTATUS === 'Applied' && <button onClick={() => cancelLeave(r.LEAVEENTRYID)} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {applyOpen && empId && <ApplyLeaveModal empId={empId} defaultTypeId={applyType} onClose={() => setApplyOpen(false)} onSaved={() => { setApplyOpen(false); load(); }} />}
      {selectedDay && <DayDetailModal day={selectedDay} onClose={() => setSelectedDay(null)} />}
    </div>
  );
}
