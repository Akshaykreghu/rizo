'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import AppTabs from '@/components/ess/AppTabs';

// Port of New Rizo's pages/ESS/ESSRequests.jsx (Expense Claims / Regularisation / Salary Advance
// / Loan Application tabs). Differences from a literal port, driven by what the real backend
// actually supports:
// - No receipt-image upload on expenses — the existing admin POST /api/expenses hardcodes
//   image to '' regardless of what's sent; adding real upload support is a separate feature.
// - No manual Authorized-By/Approved-By pickers — /api/expenses and /api/leave/requests already
//   auto-resolve the authorizer/approver from the hierarchy (getAuthorizerApprover), so the
//   employee doesn't pick anyone.
// - Salary Advance shows the CURRENT MONTH's pending advance only, because GET /api/advances
//   (lib/advances.ts listAdvances) hardcodes is_credited='N' + defaults to the current month —
//   that's a real constraint of the existing admin feature, not something added for ESS.
// - Loan Application status is Active/Completed (is_completed), not an approval-workflow badge —
//   lib/loans.ts's own comment confirms loans have no approval workflow ("creation == approval").

const BRAND = '#1E516E';

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

const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--border)', borderRadius: 8, background: 'var(--bg-page)', color: 'var(--text-primary)', boxSizing: 'border-box', fontSize: 13, outline: 'none' };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 5, display: 'block' };
const btnP: React.CSSProperties = { padding: '9px 20px', background: BRAND, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 };
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
  const [form, setForm] = useState({ expense_type: '', expense_date: '', expenses_amount: '', vendor: '', purpose: '', remarks: '' });

  const load = useCallback(() => {
    fetch('/api/expenses').then((r) => (r.ok ? r.json() : { data: [] })).then((d) => setRows(d.data || [])).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    fetch('/api/setup/expense-types').then((r) => (r.ok ? r.json() : [])).then(setTypes).catch(() => {});
  }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenseType: form.expense_type, expensesAmount: Number(form.expenses_amount),
          affectedMonth: form.expense_date.slice(0, 7), expenseDate: form.expense_date,
          vendor: form.vendor || undefined, purpose: form.purpose || undefined, remarks: form.remarks || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to save expense');
      setShowAdd(false);
      setForm({ expense_type: '', expense_date: '', expenses_amount: '', vendor: '', purpose: '', remarks: '' });
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <button style={btnP} onClick={() => setShowAdd(true)}>+ New Expense</button>
        {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
      </div>

      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Amount', 'Type', 'Date', 'Vendor', 'Status', ''].map((h) => <th key={h} style={thS}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>No expense requests found</td></tr>
              ) : rows.map((r) => (
                <tr key={r.emp_expenses_pkey}>
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
      </div>

      {showAdd && (
        <Modal title="New Expense Request" onClose={() => setShowAdd(false)}>
          <form onSubmit={handleSave}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={lbl}>Expense Type *</label>
                <select required value={form.expense_type} onChange={(e) => setForm((f) => ({ ...f, expense_type: e.target.value }))} style={inp}>
                  <option value="">-- Select --</option>
                  {types.map((t) => <option key={t.expense_type_pkey} value={t.expense_type_name}>{t.expense_type_name}</option>)}
                </select>
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
  const [form, setForm] = useState({ attDate: '', direction: 'in' as 'in' | 'out', logTime: '', remarks: '' });

  const load = useCallback(() => {
    fetch(`/api/attendance/regularisation?month=${month}`).then((r) => (r.ok ? r.json() : { data: [] })).then((d) => setRows(d.data || [])).finally(() => setLoading(false));
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
      setMessage('Regularisation request raised');
      setShowForm(false);
      setForm({ attDate: '', direction: 'in', logTime: '', remarks: '' });
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to raise request');
    } finally {
      setSaving(false);
    }
  }

  const STATUS_LABEL: Record<RegRow['approved'], string> = { A: 'Approved', R: 'Rejected', P: 'Pending' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        {!showForm && <button style={btnP} onClick={() => setShowForm(true)}>+ Raise Request</button>}
        {message && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{message}</span>}
      </div>

      {showForm && (
        <form onSubmit={submit} style={{ ...card, padding: 20, marginBottom: 16, maxWidth: 520 }}>
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
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" style={btnP} disabled={saving || !form.attDate || !form.logTime}>{saving ? 'Submitting…' : 'Submit'}</button>
            <button type="button" style={btnO} onClick={() => setShowForm(false)}>✕ Cancel</button>
          </div>
        </form>
      )}

      <div style={{ ...card, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Date', 'Direction', 'Time', 'Remarks', 'Status'].map((h) => <th key={h} style={thS}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>No requests for {month}</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id}>
                <td style={tdS}>{r.att_date}</td>
                <td style={{ ...tdS, textTransform: 'capitalize' }}>{r.direction}</td>
                <td style={tdS}>{r.LOGTIME}</td>
                <td style={{ ...tdS, color: 'var(--text-muted)' }}>{r.remarks || '—'}</td>
                <td style={tdS}><span style={badge(r.approved)}>{STATUS_LABEL[r.approved]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── SALARY ADVANCE ────────────────────────────────────────────────────────────
interface AdvanceRow { emp_advance_pkey: number; advance_amount: number; affected_month: string; remarks: string | null; payment_date: string | null }

function AdvanceTab({ empId }: { empId: number }) {
  const [rows, setRows] = useState<AdvanceRow[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ advance_amount: '', remarks: '' });

  const load = useCallback(() => {
    Promise.all([
      fetch('/api/advances').then((r) => (r.ok ? r.json() : { rows: [] })),
      fetch(`/api/advances/limit?empFkey=${empId}`).then((r) => (r.ok ? r.json() : { limit: null })),
    ]).then(([a, l]) => { setRows(a.rows || []); setLimit(l.limit ?? null); }).finally(() => setLoading(false));
  }, [empId]);

  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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

  return (
    <div>
      <div style={{ ...card, padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
          Advance requests require admin approval before payroll processing. Showing your pending request for <strong>{currentMonth()}</strong>{limit != null && <> · advisory limit <strong>₹{fmtAmt(limit)}</strong> (80% of monthly CTC)</>}.
        </div>
        <button style={btnP} onClick={() => setShowForm((v) => !v)}>{showForm ? '✕ Cancel' : '+ Apply for Advance'}</button>
      </div>

      {showForm && (
        <form onSubmit={submit} style={{ ...card, padding: 20, marginBottom: 20, maxWidth: 480 }}>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Advance Amount (₹) *</label>
            <input type="number" required min="1" step="0.01" value={form.advance_amount} onChange={(e) => setForm((f) => ({ ...f, advance_amount: e.target.value }))} style={inp} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Remarks</label>
            <textarea rows={3} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} style={{ ...inp, resize: 'vertical' }} />
          </div>
          {error && <div style={{ marginBottom: 12, fontSize: 12, color: '#dc2626' }}>{error}</div>}
          <button type="submit" style={btnP} disabled={saving}>{saving ? 'Submitting…' : 'Submit Application'}</button>
        </form>
      )}

      <div style={{ ...card, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Affected Month', 'Amount', 'Remarks', 'Payment Date'].map((h) => <th key={h} style={thS}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>No pending advance this month</td></tr>
            ) : rows.map((r) => (
              <tr key={r.emp_advance_pkey}>
                <td style={tdS}>{r.affected_month}</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{fmtAmt(r.advance_amount)}</td>
                <td style={{ ...tdS, color: 'var(--text-muted)' }}>{r.remarks || '—'}</td>
                <td style={tdS}>{fmt(r.payment_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
  const [form, setForm] = useState({ loan_amount: '', tenure: '', interest_rate: '', emi_start_month: '', remarks: '' });

  const load = useCallback(() => {
    fetch('/api/loans').then((r) => (r.ok ? r.json() : { rows: [] })).then((d) => setRows(d.rows || [])).finally(() => setLoading(false));
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
      setForm({ loan_amount: '', tenure: '', interest_rate: '', emi_start_month: '', remarks: '' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ ...card, padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
          Loan applications are effective immediately — EMI is auto-calculated as loan amount ÷ tenure.
        </div>
        <button style={btnP} onClick={() => setShowForm((v) => !v)}>{showForm ? '✕ Cancel' : '+ Apply for Loan'}</button>
      </div>

      {showForm && (
        <form onSubmit={submit} style={{ ...card, padding: 20, marginBottom: 20, maxWidth: 520 }}>
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
          <button type="submit" style={btnP} disabled={saving}>{saving ? 'Submitting…' : 'Submit Application'}</button>
        </form>
      )}

      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Loan Amount', 'Tenure', 'EMI', 'EMI Start', 'Paid', 'Status'].map((h) => <th key={h} style={thS}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} style={{ ...tdS, textAlign: 'center', color: 'var(--text-muted)' }}>No loan applications found</td></tr>
              ) : rows.map((r) => (
                <tr key={r.emp_loan_pkey}>
                  <td style={{ ...tdS, fontWeight: 700 }}>{fmtAmt(r.loan_amount)}</td>
                  <td style={tdS}>{r.tenure} mo</td>
                  <td style={tdS}>{fmtAmt(r.emi_amount)}</td>
                  <td style={tdS}>{r.emi_start_month}</td>
                  <td style={tdS}>{fmtAmt(r.loan_paid)}</td>
                  <td style={tdS}><span style={badge(r.is_completed === 'Y' ? 'Approved' : 'Authorized')}>{r.is_completed === 'Y' ? 'Completed' : 'Active'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'expenses', label: 'Expense Claims', icon: '🧾' },
  { key: 'regularization', label: 'Regularization', icon: '✏️' },
  { key: 'advance', label: 'Salary Advance', icon: '💸' },
  { key: 'loan', label: 'Loan Application', icon: '🏦' },
] as const;
type TabId = typeof TABS[number]['key'];

export default function EssRequestsPage() {
  const { data: session } = useSession();
  const empId = session?.user.empFkey;
  const [tab, setTab] = useState<TabId>('expenses');

  if (!empId) return null;

  return (
    <div className="page-content" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Requests</h1>
          <p className="page-subtitle">Submit and track your expense claims, attendance corrections, advances, and loan applications</p>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <AppTabs tabs={TABS.map((t) => ({ key: t.key, label: t.label, icon: t.icon }))} active={tab} onChange={(k) => setTab(k as TabId)} />
      </div>

      {tab === 'expenses' && <ExpensesTab />}
      {tab === 'regularization' && <RegularizationTab />}
      {tab === 'advance' && <AdvanceTab empId={empId} />}
      {tab === 'loan' && <LoanTab />}
    </div>
  );
}
