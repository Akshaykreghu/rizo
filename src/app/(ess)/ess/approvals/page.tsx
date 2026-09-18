'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import AppTabs from '@/components/ess/AppTabs';

// Port of New Rizo's pages/ESS/ESSApprovals.jsx, backed by the approver-queue mode added to
// GET /api/leave/requests (?authorizerFkey=/?approverFkey=, forced server-side to the caller's
// own empFkey) and the self-access carve-outs on the authorize/approve/reject action routes.

const BRAND = '#1E516E';

interface LeaveRow {
  LEAVEENTRYID: number; EMP_fkey: number; leave_type: string; FROMDATE: string; TODATE: string;
  leave_days: number; LEAVESTATUS: string; applied_date: string; first_name: string; last_name: string | null; emp_id: string;
}

const STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  Applied: { bg: '#eff6ff', color: '#1d4ed8' },
  Authorized: { bg: '#fefce8', color: '#854d0e' },
  Approved: { bg: '#f0fdf4', color: '#166534' },
  Rejected: { bg: '#fef2f2', color: '#991b1b' },
};

const thS: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontWeight: 700, fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', background: 'var(--bg-page)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.3px' };
const tdS: React.CSSProperties = { padding: '11px 14px', fontSize: 13, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' };
const btnSm = (bg: string, color: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: bg, color });

function StatusChip({ status }: { status: string }) {
  const s = STATUS_COLOR[status] || { bg: '#f3f4f6', color: '#374151' };
  return <span style={{ ...s, padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, display: 'inline-block' }}>{status}</span>;
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function RemarkModal({ row, action, onClose, onDone }: { row: LeaveRow; action: 'authorize' | 'approve' | 'reject'; onClose: () => void; onDone: () => void }) {
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labels = { authorize: 'Authorize', approve: 'Approve', reject: 'Reject' };
  const colors = { authorize: '#1d4ed8', approve: '#16a34a', reject: '#dc2626' };

  async function submit() {
    if (action === 'reject' && !remark.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leave/requests/${row.LEAVEENTRYID}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'reject' ? { remarks: remark } : { remarks: remark }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Action failed');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: 14, padding: 28, width: 420, boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}>
        <h3 style={{ margin: '0 0 6px', color: BRAND, fontSize: 16, fontWeight: 800 }}>{labels[action]} Leave Request</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>
          {row.first_name} {row.last_name} · {row.leave_type} · {row.FROMDATE.slice(0, 10)} – {row.TODATE.slice(0, 10)} ({row.leave_days}d)
        </p>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
          {action === 'reject' ? 'Reason for rejection *' : 'Remarks (optional)'}
        </label>
        <textarea
          value={remark} onChange={(e) => setRemark(e.target.value)} rows={3}
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)', fontSize: 13, resize: 'vertical' }}
          placeholder={action === 'reject' ? 'Enter reason...' : 'Add a remark...'}
        />
        {error && <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSm('var(--bg-page)', 'var(--text-muted)')}>Cancel</button>
          <button onClick={submit} disabled={loading || (action === 'reject' && !remark.trim())} style={btnSm(colors[action], '#fff')}>{loading ? '…' : labels[action]}</button>
        </div>
      </div>
    </div>
  );
}

export default function EssApprovalsPage() {
  const { data: session } = useSession();
  const empId = session?.user.empFkey;

  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ row: LeaveRow; action: 'authorize' | 'approve' | 'reject' } | null>(null);

  const load = useCallback(() => {
    if (!empId) return;
    fetch(`/api/leave/requests?authorizerFkey=${empId}&approverFkey=${empId}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => setRows(d.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [empId]);

  useEffect(() => { load(); }, [load]);

  const filtered = tab === 'pending' ? rows.filter((r) => ['Applied', 'Authorized'].includes(r.LEAVESTATUS)) : rows;

  function actionFor(row: LeaveRow): { label: string; action: 'authorize' | 'approve' }[] {
    if (row.LEAVESTATUS === 'Applied') return [{ label: 'Authorize', action: 'authorize' }];
    if (row.LEAVESTATUS === 'Authorized') return [{ label: 'Approve', action: 'approve' }];
    return [];
  }

  return (
    <div className="page-content" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Approvals</h1>
          <p className="page-subtitle">Leave requests waiting on your authorization or approval</p>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <AppTabs
          active={tab}
          onChange={(k) => setTab(k as 'pending' | 'history')}
          tabs={[
            { key: 'pending', label: 'Pending' },
            { key: 'history', label: 'History' },
          ]}
        />
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{tab === 'pending' ? "No pending approvals — you're all caught up!" : 'No records found.'}</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Employee', 'Leave Type', 'From', 'To', 'Days', 'Applied On', 'Status'].map((h) => <th key={h} style={thS}>{h}</th>)}
                  {tab === 'pending' && <th style={{ ...thS, textAlign: 'center' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.LEAVEENTRYID}>
                    <td style={tdS}>
                      <div style={{ fontWeight: 700 }}>{row.first_name} {row.last_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.emp_id}</div>
                    </td>
                    <td style={tdS}>{row.leave_type}</td>
                    <td style={tdS}>{fmt(row.FROMDATE)}</td>
                    <td style={tdS}>{fmt(row.TODATE)}</td>
                    <td style={{ ...tdS, fontWeight: 700 }}>{row.leave_days}</td>
                    <td style={tdS}>{fmt(row.applied_date)}</td>
                    <td style={tdS}><StatusChip status={row.LEAVESTATUS} /></td>
                    {tab === 'pending' && (
                      <td style={{ ...tdS, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                          {actionFor(row).map((a) => (
                            <button key={a.action} style={btnSm(a.action === 'authorize' ? '#1d4ed8' : '#16a34a', '#fff')} onClick={() => setModal({ row, action: a.action })}>{a.label}</button>
                          ))}
                          <button style={btnSm('#dc2626', '#fff')} onClick={() => setModal({ row, action: 'reject' })}>Reject</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && <RemarkModal row={modal.row} action={modal.action} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
    </div>
  );
}
