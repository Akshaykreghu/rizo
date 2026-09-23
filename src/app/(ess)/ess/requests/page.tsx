'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import AppTabs from '@/components/ess/AppTabs';
import { EssDropdown } from '@/components/ess/EssDropdown';
import { EssPagination } from '@/components/ess/EssPagination';

// Port of New Rizo's pages/ESS/ESSRequests.jsx (Expense Claims / Regularisation / Salary Advance
// / Loan Application tabs). Differences from a literal port, driven by what the real backend
// actually supports:
// - No receipt-image upload on expenses — the existing admin POST /api/expenses hardcodes
//   image to '' regardless of what's sent; adding real upload support is a separate feature.
// - Expenses has no manual Authorized-By/Approved-By picker — /api/expenses auto-resolves the
//   authorizer/approver from the hierarchy (getAuthorizerApprover) server-side. Leave requests
//   are different: POST /api/leave/requests does NOT auto-resolve (it only falls back to the
//   applicant's own empFkey as authorizer, and leaves approver null, when not supplied) — so the
//   Apply Leave form below has real Authorize By / Approve By pickers, same as legacy's.
// - Salary Advance shows the CURRENT MONTH's pending advance only, because GET /api/advances
//   (lib/advances.ts listAdvances) hardcodes is_credited='N' + defaults to the current month —
//   that's a real constraint of the existing admin feature, not something added for ESS.
// - Loan Application status is Active/Completed (is_completed), not an approval-workflow badge —
//   lib/loans.ts's own comment confirms loans have no approval workflow ("creation == approval").

const BRAND = '#1E516E';
const PAGE_SIZE = 10;

function fmt(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtAmt(v?: number | string | null) {
  return v != null && v !== '' ? Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';
}
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
// Local-date components, not toISOString() (which is UTC and would show yesterday's date near
// midnight IST) — same convention as currentMonth() above.
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtMonth(m: string) { const [y, mo] = m.split('-'); return `${MONTHS_SHORT[parseInt(mo) - 1]} ${y}`; }
function halfLabel(h?: number | null) { return h === 1 ? 'First Half' : h === 2 ? 'Second Half' : '—'; }
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

const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--border)', borderRadius: 8, background: 'var(--bg-page)', color: 'var(--text-primary)', boxSizing: 'border-box', fontSize: 13, outline: 'none' };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 5, display: 'block' };
const btnP: React.CSSProperties = { padding: '9px 20px', background: BRAND, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, flexShrink: 0 };
// Header row shared by every tab: a description on the left that wraps onto multiple lines
// instead of pushing the (fixed-width) action button onto its own line when the text is long.
const tabHeaderText: React.CSSProperties = { fontSize: 13, color: 'var(--text-muted)', flex: '1 1 auto', minWidth: 200 };
const btnO: React.CSSProperties = { padding: '9px 18px', background: 'transparent', border: '1.5px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' };
const btnD: React.CSSProperties = { padding: '9px 18px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#dc2626', fontWeight: 700 };
const thS: React.CSSProperties = { padding: '10px 14px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'left', borderBottom: '2px solid var(--border)', background: 'var(--bg-page)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.3px' };
const tdS: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)' };
const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 14 };

function badge(status: string) {
  const map: Record<string, { bg: string; c: string }> = {
    Applied: { bg: '#eff6ff', c: '#2563eb' },
    Authorized: { bg: '#fefce8', c: '#d97706' },
    Approved: { bg: '#f0fdf4', c: '#16a34a' },
    Rejected: { bg: '#fef2f2', c: '#dc2626' },
    Removed: { bg: '#f9fafb', c: '#6b7280' },
    P: { bg: '#fefce8', c: '#d97706' },
    A: { bg: '#f0fdf4', c: '#16a34a' },
    R: { bg: '#fef2f2', c: '#dc2626' },
  };
  const s = map[status] || { bg: '#f9fafb', c: '#6b7280' };
  return { fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: s.bg, color: s.c, display: 'inline-block' };
}

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: 16, width: '100%', maxWidth: wide ? 760 : 540, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary)' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 22, overflowY: 'auto', flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

// Shared validation/result popup — used everywhere a tab previously showed a small inline red
// line of text, which is easy to miss. `onConfirm` turns it into a Cancel/Continue pair, used for
// advisory limit warnings (the backend doesn't hard-block these, so the employee can proceed
// after being clearly told); without it, it's a single-button acknowledgement.
function AlertModal({ tone = 'error', title, message, onClose, onConfirm, confirmLabel }: {
  tone?: 'error' | 'warning' | 'success';
  title?: string;
  message: string;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
}) {
  const toneCfg = {
    error: { icon: '⛔', color: '#dc2626', bg: '#fef2f2' },
    warning: { icon: '⚠️', color: '#d97706', bg: '#fffbeb' },
    success: { icon: '✅', color: '#16a34a', bg: '#f0fdf4' },
  }[tone];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: 14, width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        <div style={{ padding: '22px 22px 16px', textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: toneCfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, margin: '0 auto 12px' }}>{toneCfg.icon}</div>
          {title && <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>{title}</div>}
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{message}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '14px 22px', borderTop: '1px solid var(--border)' }}>
          {onConfirm && (
            <button onClick={onClose} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          )}
          <button onClick={onConfirm ?? onClose} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: toneCfg.color, color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: 13 }}>{confirmLabel ?? 'OK'}</button>
        </div>
      </div>
    </div>
  );
}

// ── EXPENSES ──────────────────────────────────────────────────────────────────
interface ExpenseRow {
  emp_expenses_pkey: number; expense_type: string; expenses_amount: number; affected_month: string;
  expense_date: string; vendor: string | null; purpose: string | null; remarks: string | null;
  expense_status: string; authorized_by: string | null; approved_by: string | null;
  remarks_auth: string | null; remarks_approved: string | null;
}
interface ExpenseType { expense_type_pkey: number; expense_type_name: string }

function ExpensesTab() {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [types, setTypes] = useState<ExpenseType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [viewRow, setViewRow] = useState<ExpenseRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ expense_type: '', expense_date: today(), expenses_amount: '', vendor: '', purpose: '', remarks: '' });
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    fetch('/api/expenses').then((r) => (r.ok ? r.json() : { data: [] })).then((d) => { setRows(d.data || []); setPage(1); }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    fetch('/api/setup/expense-types').then((r) => (r.ok ? r.json() : [])).then(setTypes).catch(() => {});
  }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // expense_type is a custom dropdown (no native browser "required" validation), so a missing
    // selection needs its own explicit message instead of just leaving Submit disabled.
    if (!form.expense_type) { setError('Please select an expense type.'); return; }
    if (!form.expenses_amount || Number(form.expenses_amount) <= 0) { setError('Please enter an amount greater than 0.'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenseType: form.expense_type, expensesAmount: Number(form.expenses_amount),
          affectedMonth: `${form.expense_date.slice(0, 7)}-01`, expenseDate: form.expense_date,
          vendor: form.vendor || undefined, purpose: form.purpose || undefined, remarks: form.remarks || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to save expense');
      setShowAdd(false);
      setForm({ expense_type: '', expense_date: today(), expenses_amount: '', vendor: '', purpose: '', remarks: '' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: ExpenseRow) {
    if (row.expense_status === 'Approved') { setError('Cannot remove an already-approved claim'); return; }
    if (!confirm('Remove this expense request?')) return;
    const res = await fetch(`/api/expenses/${row.emp_expenses_pkey}`, { method: 'DELETE' });
    if (res.ok) load(); else setError((await res.json()).error || 'Failed to remove');
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={tabHeaderText}>Submit and track your expense claims.</div>
        <button style={btnP} onClick={() => setShowAdd(true)}>+ New Expense</button>
      </div>
      {!showAdd && error && <div style={{ marginBottom: 12, fontSize: 12, color: '#dc2626' }}>{error}</div>}

      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Sl.No', 'Amount', 'Type', 'Date', 'Vendor', 'Status', ''].map((h) => <th key={h} style={thS}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>No expense requests found</td></tr>
              ) : rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r, i) => (
                <tr key={r.emp_expenses_pkey}>
                  <td style={tdS}>{(page - 1) * PAGE_SIZE + i + 1}</td>
                  <td style={{ ...tdS, fontWeight: 700 }}>{fmtAmt(r.expenses_amount)}</td>
                  <td style={tdS}>{r.expense_type}</td>
                  <td style={tdS}>{fmt(r.expense_date)}</td>
                  <td style={tdS}>{r.vendor || '—'}</td>
                  <td style={tdS}><span style={badge(r.expense_status)}>{r.expense_status}</span></td>
                  <td style={tdS}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => setViewRow(r)} style={{ ...btnO, padding: '4px 12px', fontSize: 11 }}>View</button>
                      {r.expense_status === 'Applied' && <button onClick={() => remove(r)} style={{ ...btnD, padding: '4px 12px', fontSize: 11 }}>Remove</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <EssPagination page={page} pageSize={PAGE_SIZE} totalItems={rows.length} onChange={setPage} />
      </div>

      {showAdd && (
        <Modal title="New Expense Request" onClose={() => setShowAdd(false)}>
          <form onSubmit={handleSave}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={lbl}>Expense Type *</label>
                <EssDropdown
                  value={form.expense_type}
                  onChange={(v) => setForm((f) => ({ ...f, expense_type: v }))}
                  placeholder="-- Select --"
                  options={types.map((t) => ({ value: t.expense_type_name, label: t.expense_type_name }))}
                />
              </div>
              <div>
                <label style={lbl}>Expense Date *</label>
                <input type="date" required value={form.expense_date} onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={lbl}>Amount (₹) *</label>
                <input type="number" required min="1" step="0.01" value={form.expenses_amount} onChange={(e) => setForm((f) => ({ ...f, expenses_amount: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={lbl}>Vendor</label>
                <input value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} style={inp} />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Purpose</label>
              <input value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} style={inp} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Remarks</label>
              <input value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} style={inp} />
            </div>
            {error && <div style={{ marginBottom: 12, fontSize: 12, color: '#dc2626' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" style={btnO} onClick={() => setShowAdd(false)}>Cancel</button>
              <button type="submit" style={btnP} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}

      {viewRow && (
        <Modal title="Expense Details" onClose={() => setViewRow(null)}>
          {[
            ['Amount', fmtAmt(viewRow.expenses_amount)], ['Type', viewRow.expense_type], ['Date', fmt(viewRow.expense_date)],
            ['Vendor', viewRow.vendor || '—'], ['Purpose', viewRow.purpose || '—'], ['Remarks', viewRow.remarks || '—'],
            ['Status', viewRow.expense_status],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 120, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0 }}>{k}</div>
              <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{v}</div>
            </div>
          ))}
          {viewRow.remarks_auth && <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}><strong>Authorizer remark:</strong> {viewRow.remarks_auth}</div>}
          {viewRow.remarks_approved && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}><strong>Approver remark:</strong> {viewRow.remarks_approved}</div>}
        </Modal>
      )}
    </div>
  );
}

// ── REGULARIZATION ────────────────────────────────────────────────────────────
interface RegRow { id: number; att_date: string; direction: 'in' | 'out'; remarks: string | null; LOGTIME: string; approved: 'P' | 'A' | 'R' }

function RegularizationTab() {
  const [month] = useState(currentMonth());
  const [rows, setRows] = useState<RegRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('error');
  const [form, setForm] = useState({ attDate: today(), direction: 'in' as 'in' | 'out', logTime: nowTime(), remarks: '' });
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    fetch(`/api/attendance/regularisation?month=${month}`).then((r) => (r.ok ? r.json() : { data: [] })).then((d) => { setRows(d.data || []); setPage(1); }).finally(() => setLoading(false));
  }, [month]);

  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/attendance/regularisation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to raise request');
      setMessageTone('success');
      setMessage('Regularisation request raised');
      setShowForm(false);
      setForm({ attDate: today(), direction: 'in', logTime: nowTime(), remarks: '' });
      load();
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Failed to raise request');
    } finally {
      setSaving(false);
    }
  }

  const STATUS_LABEL: Record<RegRow['approved'], string> = { A: 'Approved', R: 'Rejected', P: 'Pending' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={tabHeaderText}>Raise a request to correct a missed or incorrect attendance punch.</div>
        <button style={btnP} onClick={() => setShowForm(true)}>+ Raise Request</button>
      </div>
      {!showForm && message && <div style={{ marginBottom: 12, fontSize: 12, color: messageTone === 'success' ? '#16a34a' : '#dc2626' }}>{message}</div>}

      {showForm && (
        <Modal title="Raise Regularisation Request" onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={lbl}>Date *</label>
                <input type="date" required value={form.attDate} onChange={(e) => setForm((f) => ({ ...f, attDate: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={lbl}>Direction *</label>
                <select value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value as 'in' | 'out' }))} style={inp}>
                  <option value="in">In</option>
                  <option value="out">Out</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Time *</label>
                <input type="time" step={1} required value={form.logTime} onChange={(e) => setForm((f) => ({ ...f, logTime: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={lbl}>Remarks</label>
                <input value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} style={inp} />
              </div>
            </div>
            {message && <div style={{ marginBottom: 12, fontSize: 12, color: '#dc2626' }}>{message}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" style={btnO} onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" style={btnP} disabled={saving || !form.attDate || !form.logTime}>{saving ? 'Submitting…' : 'Submit'}</button>
            </div>
          </form>
        </Modal>
      )}

      <div style={{ ...card, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Sl.No', 'Date', 'Direction', 'Time', 'Remarks', 'Status'].map((h) => <th key={h} style={thS}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>No requests for {month}</td></tr>
            ) : rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r, i) => (
              <tr key={r.id}>
                <td style={tdS}>{(page - 1) * PAGE_SIZE + i + 1}</td>
                <td style={tdS}>{r.att_date}</td>
                <td style={{ ...tdS, textTransform: 'capitalize' }}>{r.direction}</td>
                <td style={tdS}>{r.LOGTIME}</td>
                <td style={{ ...tdS, color: 'var(--text-muted)' }}>{r.remarks || '—'}</td>
                <td style={tdS}><span style={badge(r.approved)}>{STATUS_LABEL[r.approved]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <EssPagination page={page} pageSize={PAGE_SIZE} totalItems={rows.length} onChange={setPage} />
      </div>
    </div>
  );
}

// ── SALARY ADVANCE ────────────────────────────────────────────────────────────
interface AdvanceRow { emp_advance_pkey: number; advance_amount: number; affected_month: string; remarks: string | null; payment_date: string | null; is_credited: 'Y' | 'N' }

function AdvanceTab() {
  const { data: session } = useSession();
  const empId = session?.user.empFkey;
  const [rows, setRows] = useState<AdvanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ advance_amount: '', remarks: '' });
  const [page, setPage] = useState(1);
  // Real, legacy-derived advisory limit (80% of one month's gross CTC) — GET /api/advances/limit
  // already existed for this; the backend itself never hard-blocks a save that exceeds it, so this
  // is surfaced as a warning the employee can proceed past, not a hard client-side cap.
  const [limit, setLimit] = useState<number | null>(null);
  const [limitWarning, setLimitWarning] = useState(false);

  const load = useCallback(() => {
    fetch('/api/advances').then((r) => (r.ok ? r.json() : { rows: [] })).then((a) => { setRows(a.rows || []); setPage(1); }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!empId) return;
    fetch(`/api/advances/limit?empFkey=${empId}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setLimit(d.limit)).catch(() => {});
  }, [empId]);

  async function doSubmit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/advances', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ advanceAmount: Number(form.advance_amount), affectedMonth: currentMonth(), remarks: form.remarks || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to submit advance request');
      setShowForm(false);
      setForm({ advance_amount: '', remarks: '' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSaving(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (limit != null && Number(form.advance_amount) > limit) { setLimitWarning(true); return; }
    doSubmit();
  }

  async function withdraw(row: AdvanceRow) {
    if (!confirm('Withdraw this advance request?')) return;
    const res = await fetch(`/api/advances/${row.emp_advance_pkey}`, { method: 'DELETE' });
    if (res.ok) load(); else setError((await res.json()).error || 'Failed to withdraw');
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={tabHeaderText}>Advance requests require admin approval before payroll processing.</div>
        <button style={btnP} onClick={() => setShowForm(true)}>+ Apply for Advance</button>
      </div>
      {!showForm && error && <div style={{ marginBottom: 12, fontSize: 12, color: '#dc2626' }}>{error}</div>}
      {limitWarning && (
        <AlertModal
          tone="warning"
          title="Amount exceeds your advisory limit"
          message={`Your advance is normally limited to ₹${fmtAmt(limit)} (80% of one month's gross pay). You can still submit this request, but it will need extra admin review before payroll processing.`}
          onClose={() => setLimitWarning(false)}
          onConfirm={() => { setLimitWarning(false); doSubmit(); }}
          confirmLabel="Submit Anyway"
        />
      )}

      {showForm && (
        <Modal title="New Advance Request" onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Advance Amount (₹) *</label>
              <input type="number" required min="1" step="0.01" value={form.advance_amount} onChange={(e) => setForm((f) => ({ ...f, advance_amount: e.target.value }))} style={inp} />
              {limit != null && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Advisory limit: ₹{fmtAmt(limit)} (80% of one month&apos;s gross)</div>}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Remarks</label>
              <textarea rows={3} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} style={{ ...inp, resize: 'vertical' }} />
            </div>
            {error && <div style={{ marginBottom: 12, fontSize: 12, color: '#dc2626' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" style={btnO} onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" style={btnP} disabled={saving}>{saving ? 'Submitting…' : 'Submit Application'}</button>
            </div>
          </form>
        </Modal>
      )}

      <div style={{ ...card, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Sl.No', 'Affected Month', 'Amount', 'Remarks', 'Payment Date', ''].map((h) => <th key={h} style={thS}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>No pending advance this month</td></tr>
            ) : rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r, i) => (
              <tr key={r.emp_advance_pkey}>
                <td style={tdS}>{(page - 1) * PAGE_SIZE + i + 1}</td>
                <td style={tdS}>{r.affected_month}</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{fmtAmt(r.advance_amount)}</td>
                <td style={{ ...tdS, color: 'var(--text-muted)' }}>{r.remarks || '—'}</td>
                <td style={tdS}>{fmt(r.payment_date)}</td>
                <td style={tdS}>
                  {r.is_credited === 'N' && <button onClick={() => withdraw(r)} style={{ ...btnD, padding: '4px 12px', fontSize: 11 }}>Withdraw</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <EssPagination page={page} pageSize={PAGE_SIZE} totalItems={rows.length} onChange={setPage} />
      </div>
    </div>
  );
}

// ── LOAN APPLICATION ──────────────────────────────────────────────────────────
interface LoanRow {
  emp_loan_pkey: number; loan_amount: number; tenure: number; intrest_rate: number; emi_amount: number;
  emi_start_month: string; emi_end_month: string; remarks: string | null; is_completed: 'Y' | 'N'; loan_paid: string | null;
}

function LoanTab() {
  const [rows, setRows] = useState<LoanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ loan_amount: '', tenure: '', interest_rate: '', emi_start_month: currentMonth(), remarks: '' });
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    fetch('/api/loans').then((r) => (r.ok ? r.json() : { rows: [] })).then((d) => { setRows(d.rows || []); setPage(1); }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const emiPreview = form.loan_amount && form.tenure && parseInt(form.tenure) > 0
    ? fmtAmt(parseFloat(form.loan_amount) / parseInt(form.tenure))
    : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/loans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loanAmount: parseFloat(form.loan_amount), tenure: parseInt(form.tenure),
          interestRate: form.interest_rate ? parseFloat(form.interest_rate) : 0,
          emiStartMonth: form.emi_start_month, remarks: form.remarks || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to submit loan application');
      setShowForm(false);
      setForm({ loan_amount: '', tenure: '', interest_rate: '', emi_start_month: currentMonth(), remarks: '' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSaving(false);
    }
  }

  async function withdraw(row: LoanRow) {
    if (!confirm('Withdraw this loan application?')) return;
    const res = await fetch(`/api/loans/${row.emp_loan_pkey}`, { method: 'DELETE' });
    if (res.ok) load(); else setError((await res.json()).error || 'Failed to withdraw');
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={tabHeaderText}>
          Loan applications are effective immediately — EMI is auto-calculated as loan amount ÷ tenure.
        </div>
        <button style={btnP} onClick={() => setShowForm(true)}>+ Apply for Loan</button>
      </div>
      {!showForm && error && <div style={{ marginBottom: 12, fontSize: 12, color: '#dc2626' }}>{error}</div>}

      {showForm && (
        <Modal title="New Loan Application" onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={lbl}>Loan Amount (₹) *</label>
                <input type="number" required min="1" step="0.01" value={form.loan_amount} onChange={(e) => setForm((f) => ({ ...f, loan_amount: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={lbl}>Tenure (months) *</label>
                <input type="number" required min="1" step="1" value={form.tenure} onChange={(e) => setForm((f) => ({ ...f, tenure: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={lbl}>Interest Rate (%)</label>
                <input type="number" min="0" step="0.01" value={form.interest_rate} onChange={(e) => setForm((f) => ({ ...f, interest_rate: e.target.value }))} style={inp} placeholder="0 for interest-free" />
              </div>
              <div>
                <label style={lbl}>EMI Start Month *</label>
                <input type="month" required value={form.emi_start_month} onChange={(e) => setForm((f) => ({ ...f, emi_start_month: e.target.value }))} style={inp} />
              </div>
            </div>
            {emiPreview && <div style={{ background: `${BRAND}10`, border: `1px solid ${BRAND}30`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, fontWeight: 700, color: BRAND }}>Estimated Monthly EMI: ₹{emiPreview}</div>}
            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Remarks</label>
              <textarea rows={3} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} style={{ ...inp, resize: 'vertical' }} />
            </div>
            {error && <div style={{ marginBottom: 12, fontSize: 12, color: '#dc2626' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" style={btnO} onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" style={btnP} disabled={saving}>{saving ? 'Submitting…' : 'Submit Application'}</button>
            </div>
          </form>
        </Modal>
      )}

      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Sl.No', 'Loan Amount', 'Tenure', 'EMI', 'EMI Start', 'Paid', 'Status', ''].map((h) => <th key={h} style={thS}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>No loan applications found</td></tr>
              ) : rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r, i) => (
                <tr key={r.emp_loan_pkey}>
                  <td style={tdS}>{(page - 1) * PAGE_SIZE + i + 1}</td>
                  <td style={{ ...tdS, fontWeight: 700 }}>{fmtAmt(r.loan_amount)}</td>
                  <td style={tdS}>{r.tenure} mo</td>
                  <td style={tdS}>{fmtAmt(r.emi_amount)}</td>
                  <td style={tdS}>{r.emi_start_month}</td>
                  <td style={tdS}>{fmtAmt(r.loan_paid)}</td>
                  <td style={tdS}><span style={badge(r.is_completed === 'Y' ? 'Approved' : 'Authorized')}>{r.is_completed === 'Y' ? 'Completed' : 'Active'}</span></td>
                  <td style={tdS}>
                    {r.is_completed === 'N' && (!r.loan_paid || Number(r.loan_paid) === 0) && (
                      <button onClick={() => withdraw(r)} style={{ ...btnD, padding: '4px 12px', fontSize: 11 }}>Withdraw</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <EssPagination page={page} pageSize={PAGE_SIZE} totalItems={rows.length} onChange={setPage} />
      </div>
    </div>
  );
}

// ── LEAVE ─────────────────────────────────────────────────────────────────────
// Moved here from the Presence page — leave application/tracking is a request-and-approve
// workflow like the other three tabs, whereas Presence is purely attendance history/analytics.
interface LeaveRow {
  LEAVEENTRYID: number; leave_type: string; FROMDATE: string; FROMHALF: number; TODATE: string; TOHALF: number;
  leave_days: number; LEAVESTATUS: string; applied_date: string;
  Reason: string | null; contact_person: string | null; contact_No: string | null;
  ISAutherizedby: number | null; Autherized_date: string | null; authorized_by_first_name: string | null; authorized_by_last_name: string | null;
  APPROVEDBY: number | null; APPROVED_date: string | null; approved_by_first_name: string | null; approved_by_last_name: string | null;
  REMARKS: string | null;
}
interface LeaveType { salaryHeadItemFkey: number; name: string; occurance: string; allowNegative: boolean; maxLeave: number }

// Human-readable overrides for statuses whose raw enum value reads poorly as-is.
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
    CancellationOfAuthorized: ['#86198f', '#fdf4ff'], CancellationOfApproved: ['#86198f', '#fdf4ff'],
  };
  const [color, bg] = cfg[status] || [BRAND, '#e0f2fe'];
  return <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color, background: bg }}>{STATUS_TEXT_LABEL[status] ?? status}</span>;
}
const STATUS_STRIPE: Record<string, string> = { Applied: BRAND, Authorized: '#7c3aed', Approved: '#16a34a', Rejected: '#dc2626', Cancelled: '#94a3b8' };

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

interface LeaveBalancePreview {
  balance: number; allowNegative: boolean; minLeaveLimit: number; maxLeaveLimit: number;
  minServiceOk: boolean; minServiceMessage: string | null;
  advanceNoticeOk: boolean; advanceNoticeMessage: string | null;
  documentMandatory: boolean; remarks: string | null;
}

// These modals are bespoke fixed-overlay divs (not the shared components/ui/Modal, which already
// locks scroll) — without this, the mouse wheel still scrolls the page behind the overlay while a
// modal is open, same pattern components/ui/Modal.tsx uses.
function useLockBodyScroll() {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);
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

function ApplyLeaveModal({ empId, defaultTypeId, onClose, onSaved }: { empId: number; defaultTypeId?: number | null; onClose: () => void; onSaved: () => void }) {
  useLockBodyScroll();
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [authorizerOptions, setAuthorizerOptions] = useState<{ empFkey: number; name: string }[]>([]);
  const [approverOptions, setApproverOptions] = useState<{ empFkey: number; name: string }[]>([]);
  const [authorizerFkey, setAuthorizerFkey] = useState('');
  const [approverFkey, setApproverFkey] = useState('');
  const [authorizerQuery, setAuthorizerQuery] = useState('');
  const [approverQuery, setApproverQuery] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<LeaveBalancePreview | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [form, setForm] = useState({ leave_type_id: defaultTypeId ? String(defaultTypeId) : '', from_date: today(), from_half: '1', to_date: today(), to_half: '2', reason: '', contact_person: '', contact_no: '' });

  useEffect(() => {
    fetch(`/api/leave/types?employee=${empId}`).then((r) => (r.ok ? r.json() : { data: [] })).then((d) => setTypes(d.data || []));
    // leave_auth_apr_person_fn can return MULTIPLE eligible people per role (comma-list) — when the
    // hierarchy only configures exactly one, auto-select it so the common case needs no extra click.
    fetch(`/api/leave/authorizers?employee=${empId}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setAuthorizerOptions(d.authorizers || []);
      setApproverOptions(d.approvers || []);
      if (d.authorizers?.length === 1) setAuthorizerFkey(String(d.authorizers[0].empFkey));
      if (d.approvers?.length === 1) setApproverFkey(String(d.approvers[0].empFkey));
    });
  }, [empId]);

  // Real per-type balance + minimum-service/advance-notice eligibility, from the same endpoint
  // legacy's own Apply Leave form calls whenever the type or From Date changes — was wired up for
  // admin only until now, so ESS never had a way to check any of this before submitting.
  useEffect(() => {
    if (!form.leave_type_id || !form.from_date) return;
    fetch(`/api/leave/balance-preview?employee=${empId}&leaveType=${form.leave_type_id}&fromDate=${form.from_date}`)
      .then((r) => (r.ok ? r.json() : null)).then(setPreview).catch(() => setPreview(null));
  }, [empId, form.leave_type_id, form.from_date]);

  const leaveDays = calcLeaveDays(form.from_date, Number(form.from_half), form.to_date, Number(form.to_half));

  async function doSubmit() {
    setSaving(true);
    setError(null);
    try {
      let fileName: string | undefined;
      let fileType: string | undefined;
      if (file) {
        setUploading(true);
        const fd = new FormData();
        fd.append('file', file);
        const upRes = await fetch('/api/upload', { method: 'POST', body: fd });
        const upBody = await upRes.json();
        setUploading(false);
        if (!upRes.ok) throw new Error(upBody.error || 'Failed to upload document');
        fileName = upBody.path;
        fileType = file.type;
      }
      const res = await fetch('/api/leave/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salaryHeadItemFkey: Number(form.leave_type_id), fromDate: form.from_date, fromHalf: Number(form.from_half),
          toDate: form.to_date, toHalf: Number(form.to_half), reason: form.reason, contactNo: form.contact_no, contactPerson: form.contact_person,
          authorizerFkey: Number(authorizerFkey), approverFkey: Number(approverFkey), fileName, fileType,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to apply');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply');
    } finally {
      setUploading(false);
      setSaving(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Explicit messages instead of a silently-disabled Submit button — clicking Submit with a
    // required field missing now says exactly what's missing via the same alert modal.
    if (!form.leave_type_id) { setError('Please select a leave type.'); return; }
    if (!form.from_date || !form.to_date) { setError('Please choose a From and To date.'); return; }
    if (!form.reason.trim()) { setError('Please enter a reason for your leave.'); return; }
    if (!authorizerFkey) { setError('Please select who should Authorize this leave.'); return; }
    if (!approverFkey) { setError('Please select who should Approve this leave.'); return; }
    if (preview?.documentMandatory && !file) { setError('A supporting document is required for this leave type.'); return; }
    // Genuine policy ineligibility (not served yet / applied too late) — hard block, same as
    // legacy's own Apply Leave form.
    if (preview && !preview.minServiceOk) { setError(preview.minServiceMessage); return; }
    if (preview && !preview.advanceNoticeOk) { setError(preview.advanceNoticeMessage); return; }
    // Per-request-max overflow just becomes Loss of Pay for the excess, same as the Advance tab's
    // limit — /api/leave/requests itself never blocks on this — so it's a Continue-Anyway warning.
    if (preview && preview.maxLeaveLimit > 0 && leaveDays > preview.maxLeaveLimit) {
      setWarning(`This leave type allows a maximum of ${preview.maxLeaveLimit} day(s) per request. You're requesting ${leaveDays}.`);
      return;
    }
    // Balance is a hard stop, unlike the max-per-request limit above — legacy's own client-side
    // validateLeave() blocks purely on `leave_balance < diffDays` regardless of ALLOW_NEGETIVE, so a
    // 0-balance leave type can never be submitted here even though allowNegative would otherwise let
    // the excess through as Loss of Pay for a partial-balance request.
    if (preview && leaveDays > preview.balance) {
      setError(`You do not have enough leave balance. Available: ${preview.balance} day(s), requested: ${leaveDays}.`);
      return;
    }
    doSubmit();
  }

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
            <EssDropdown
              value={form.leave_type_id}
              onChange={(v) => setForm((f) => ({ ...f, leave_type_id: v }))}
              placeholder="-- Select --"
              options={types.map((t) => ({ value: String(t.salaryHeadItemFkey), label: t.occurance ? `${t.name} (${t.occurance})` : t.name }))}
            />
            {preview && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Balance: <strong style={{ color: preview.balance >= 0 ? 'var(--text-primary)' : '#dc2626' }}>{preview.balance}</strong> day(s)
                {preview.maxLeaveLimit > 0 && ` · Max ${preview.maxLeaveLimit}/request`}
              </div>
            )}
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
          {leaveDays > 0 && preview && (!preview.minServiceOk || (preview.minServiceOk && !preview.advanceNoticeOk)) && (
            <div style={{ marginBottom: 14, padding: '8px 14px', borderRadius: 8, background: `${BRAND}12`, border: `1px solid ${BRAND}33`, fontSize: 11, fontWeight: 700, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {!preview.minServiceOk && <span style={{ color: '#dc2626' }}>Not yet eligible</span>}
              {preview.minServiceOk && !preview.advanceNoticeOk && <span style={{ color: '#d97706' }}>Needs more advance notice</span>}
            </div>
          )}
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <PersonPicker
              label="Authorize By" required inp={inp} lbl={lbl}
              options={authorizerOptions} value={authorizerFkey} query={authorizerQuery}
              onQueryChange={setAuthorizerQuery} onSelect={setAuthorizerFkey}
            />
            <PersonPicker
              label="Approve By" required inp={inp} lbl={lbl}
              options={approverOptions} value={approverFkey} query={approverQuery}
              onQueryChange={setApproverQuery} onSelect={setApproverFkey}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>
              Supporting Document {preview?.documentMandatory && <span style={{ color: '#dc2626' }}>*</span>}
            </label>
            <input
              type="file"
              style={inp}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {preview?.remarks && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{preview.remarks}</div>}
          </div>
          {error && <div style={{ marginBottom: 12, fontSize: 12, color: '#dc2626' }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ padding: '8px 22px', borderRadius: 8, border: 'none', background: BRAND, color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: 13, opacity: saving ? 0.7 : 1 }}>
              {uploading ? 'Uploading…' : saving ? 'Submitting…' : 'Submit Leave'}
            </button>
          </div>
        </form>
      </div>
      {warning && (
        <AlertModal
          tone="warning"
          title="Check before you submit"
          message={warning}
          onClose={() => setWarning(null)}
          onConfirm={() => { setWarning(null); doSubmit(); }}
          confirmLabel="Submit Anyway"
        />
      )}
    </div>
  );
}

function LeaveDetailModal({ leave: r, onClose, onCancelled }: { leave: LeaveRow; onClose: () => void; onCancelled: () => void }) {
  const [cancelling, setCancelling] = useState(false);

  async function handleCancel() {
    setCancelling(true);
    try {
      await fetch(`/api/leave/requests/${r.LEAVEENTRYID}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      onCancelled();
    } finally {
      setCancelling(false);
    }
  }

  const sec = leaveDetailSec;
  const secLabel = leaveDetailSecLabel;
  const authorizedByName = r.authorized_by_first_name ? `${r.authorized_by_first_name} ${r.authorized_by_last_name || ''}`.trim() : null;
  const approvedByName = r.approved_by_first_name ? `${r.approved_by_first_name} ${r.approved_by_last_name || ''}`.trim() : null;

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

        <div style={sec}>
          <div style={secLabel}>Duration</div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>From</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{fmt(r.FROMDATE)}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{halfLabel(r.FROMHALF)}</div>
            </div>
            <div style={{ fontSize: 18, color: 'var(--text-muted)', fontWeight: 300 }}>→</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>To</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{fmt(r.TODATE)}</div>
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
          <LeaveInfoRow label="Applied On" value={fmt(r.applied_date)} />
          <LeaveInfoRow
            label="Authorized By"
            value={authorizedByName ? `${authorizedByName}${r.Autherized_date ? ' · ' + fmt(r.Autherized_date) : ''}` : (r.LEAVESTATUS === 'Applied' ? 'Pending' : '—')}
          />
          <LeaveInfoRow
            label="Approved By"
            value={approvedByName ? `${approvedByName}${r.APPROVED_date ? ' · ' + fmt(r.APPROVED_date) : ''}` : (r.LEAVESTATUS === 'Authorized' || r.LEAVESTATUS === 'Applied' ? 'Pending' : '—')}
          />
          {r.LEAVESTATUS === 'Rejected' && r.REMARKS && (
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #dc262622' }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: '#dc2626', textTransform: 'uppercase', marginBottom: 3 }}>Rejection Remarks</div>
              <div style={{ fontSize: 11, color: '#dc2626' }}>{r.REMARKS}</div>
            </div>
          )}
        </div>

        <div style={{ padding: '14px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Close</button>
          {r.LEAVESTATUS === 'Applied' && (
            <button onClick={handleCancel} disabled={cancelling} style={{ padding: '8px 18px', borderRadius: 8, border: '1.5px solid #dc262644', background: '#fef2f2', color: '#dc2626', fontWeight: 800, cursor: 'pointer', fontSize: 13, opacity: cancelling ? 0.7 : 1 }}>
              {cancelling ? 'Cancelling…' : 'Cancel Leave'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LeaveTab({ empId }: { empId: number }) {
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyType, setApplyType] = useState<number | null>(null);
  const [selectedLeaveRequest, setSelectedLeaveRequest] = useState<LeaveRow | null>(null);
  const [page, setPage] = useState(1);

  const nowMonth = new Date().toISOString().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(nowMonth);

  const load = useCallback(() => {
    fetch('/api/leave/requests').then((r) => (r.ok ? r.json() : { data: [] }))
      .then((l) => { setLeaves(l.data || []); setPage(1); }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Matches legacy's own empleaverequests DataTable month filter (keyed off FROMDATE's YYYY-MM),
  // not an overlap check against multi-month spans.
  const monthLeaves = leaves.filter((r) => r.FROMDATE.slice(0, 7) === selectedMonth);

  function shiftMonth(delta: number) {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    setPage(1);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Apply for leave and track the status of your requests.</div>
        <button style={btnP} onClick={() => { setApplyType(null); setApplyOpen(true); }}>+ Apply Leave</button>
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          <div style={{ ...card, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px 10px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>My Leave Requests</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Click any row to view full details</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-page)', borderRadius: 10, padding: '4px 8px', border: '1px solid var(--border)' }}>
                <button onClick={() => shiftMonth(-1)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 15, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>‹</button>
                <input
                  type="month"
                  value={selectedMonth}
                  max={nowMonth}
                  onChange={(e) => { if (e.target.value) { setSelectedMonth(e.target.value); setPage(1); } }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer', outline: 'none' }}
                />
                <button onClick={() => selectedMonth < nowMonth && shiftMonth(1)} style={{ background: 'none', border: 'none', color: selectedMonth >= nowMonth ? 'var(--border)' : 'var(--text-muted)', fontSize: 15, cursor: selectedMonth >= nowMonth ? 'default' : 'pointer', padding: '0 4px', lineHeight: 1 }}>›</button>
                {selectedMonth !== nowMonth && (
                  <button onClick={() => { setSelectedMonth(nowMonth); setPage(1); }} style={{ background: `${BRAND}15`, border: 'none', color: BRAND, fontSize: 10, fontWeight: 700, cursor: 'pointer', borderRadius: 6, padding: '2px 8px' }}>Today</button>
                )}
                <span style={{ fontSize: 10, color: 'var(--text-muted)', paddingLeft: 4 }}>{monthLeaves.length} this month</span>
              </div>
            </div>
            {monthLeaves.length === 0 ? (
              <div style={{ padding: '24px 18px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>No leave requests for {fmtMonth(selectedMonth)}</div>
            ) : (
              <div>
                {monthLeaves.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r) => (
                  <div
                    key={r.LEAVEENTRYID}
                    onClick={() => setSelectedLeaveRequest(r)}
                    style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}
                  >
                    <div style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: STATUS_STRIPE[r.LEAVESTATUS] || BRAND, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>{r.leave_type}</span>
                        <StatusBadge status={r.LEAVESTATUS} />
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {fmt(r.FROMDATE)}{r.FROMHALF ? <span style={{ fontSize: 9, marginLeft: 3 }}>({halfLabel(r.FROMHALF)})</span> : null}
                        {' → '}
                        {fmt(r.TODATE)}{r.TOHALF ? <span style={{ fontSize: 9, marginLeft: 3 }}>({halfLabel(r.TOHALF)})</span> : null}
                        {' · '}<strong style={{ color: 'var(--text-primary)' }}>{r.leave_days}d</strong>
                      </div>
                      {r.Reason && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.Reason}</div>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, alignSelf: 'center' }}>›</div>
                  </div>
                ))}
                <EssPagination page={page} pageSize={PAGE_SIZE} totalItems={monthLeaves.length} onChange={setPage} />
              </div>
            )}
          </div>
        </>
      )}

      {applyOpen && <ApplyLeaveModal empId={empId} defaultTypeId={applyType} onClose={() => setApplyOpen(false)} onSaved={() => { setApplyOpen(false); load(); }} />}
      {selectedLeaveRequest && (
        <LeaveDetailModal
          leave={selectedLeaveRequest}
          onClose={() => setSelectedLeaveRequest(null)}
          onCancelled={() => { setSelectedLeaveRequest(null); load(); }}
        />
      )}
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'leave', label: 'Leave', icon: '🌴' },
  { key: 'expenses', label: 'Expense Claims', icon: '🧾' },
  { key: 'regularization', label: 'Regularization', icon: '✏️' },
  { key: 'advance', label: 'Salary Advance', icon: '💸' },
  { key: 'loan', label: 'Loan Application', icon: '🏦' },
] as const;
type TabId = typeof TABS[number]['key'];

function EssRequestsContent() {
  const { data: session } = useSession();
  const empId = session?.user.empFkey;
  // Supports deep-linking to a specific tab (e.g. /ess/requests?tab=regularization from the
  // Presence page's day panel) — falls back to 'leave' when absent or not a real tab key.
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const initialTab = (TABS.some((t) => t.key === requestedTab) ? requestedTab : 'leave') as TabId;
  const [tab, setTab] = useState<TabId>(initialTab);

  if (!empId) return null;

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Requests</h1>
          <p className="page-subtitle">Apply for leave and submit expense claims, attendance corrections, advances, and loan applications</p>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <AppTabs tabs={TABS.map((t) => ({ key: t.key, label: t.label, icon: t.icon }))} active={tab} onChange={(k) => setTab(k as TabId)} />
      </div>

      {tab === 'leave' && <LeaveTab empId={empId} />}
      {tab === 'expenses' && <ExpensesTab />}
      {tab === 'regularization' && <RegularizationTab />}
      {tab === 'advance' && <AdvanceTab />}
      {tab === 'loan' && <LoanTab />}
    </div>
  );
}

export default function EssRequestsPage() {
  return (
    <Suspense fallback={null}>
      <EssRequestsContent />
    </Suspense>
  );
}
