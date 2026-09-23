'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import AppTabs from '@/components/ess/AppTabs';
import { EssPagination } from '@/components/ess/EssPagination';

// Port of New Rizo's pages/ESS/ESSApprovals.jsx, backed by the approver-queue mode added to
// GET /api/leave/requests (?authorizerFkey=/?approverFkey=, forced server-side to the caller's
// own empFkey) and the self-access carve-outs on the authorize/approve/reject/cancellation-approve/
// cancellation-reject action routes. Brought to parity with the admin (dashboard)/leave/requests
// page: same role-aware pending/history split and the same cancellation review step, so a team
// leave request and its cancellation both surface here for whichever of authorizer/approver owns
// the next action, exactly as they do for admin.
//
// Also ports RegularisationController::hierarchyindex()/listhierarchyregularization()/bulkupdate() —
// legacy's hierarchy-approver queue for attendance regularisation requests, a genuinely separate
// workflow from leave (single-stage approve/reject, not authorize-then-approve). Requests are
// routed to a hierarchy head via employee_regularaization.approved_person, set from the requester's
// emp_proff.attr1 at raise time; confirmed live in the dev DB (approved_person values match
// emp_proff.attr1 for the same employees). Uses the same GET/decide/bulk-decide routes as the
// admin-side /attendance/regularisation page, scoped server-side via ?scope=hierarchy.

const BRAND = '#1E516E';

interface LeaveRow {
  LEAVEENTRYID: number; EMP_fkey: number; leave_type: string; FROMDATE: string; TODATE: string;
  leave_days: number; LEAVESTATUS: string; applied_date: string; first_name: string; last_name: string | null; emp_id: string;
  ISAutherizedby: number | null; APPROVEDBY: number | null; APPROVED_date: string | null;
}

const STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  Applied: { bg: '#eff6ff', color: '#1d4ed8' },
  Authorized: { bg: '#fefce8', color: '#854d0e' },
  Approved: { bg: '#f0fdf4', color: '#166534' },
  Rejected: { bg: '#fef2f2', color: '#991b1b' },
  Cancelled: { bg: '#f3f4f6', color: '#374151' },
  CancelledByAdmin: { bg: '#f3f4f6', color: '#374151' },
  CancellationOfAuthorized: { bg: '#fdf4ff', color: '#86198f' },
  CancellationOfApproved: { bg: '#fdf4ff', color: '#86198f' },
};

const STATUS_LABEL: Record<string, string> = {
  CancellationOfAuthorized: 'Cancellation of Authorized',
  CancellationOfApproved: 'Cancellation of Approved',
  CancelledByAdmin: 'Cancelled by Admin',
};

// Mirrors legacy LeaveRequestController's listempleaves()/listempleavesverified() + manageempleave()'s
// $myrole split, and the admin (dashboard)/leave/requests page this ESS page is meant to match: which
// of the two roles (authorizer vs approver) a given row belongs to for the current viewer, and what
// they're allowed to do with it right now. A row can be irrelevant to the viewer in the "wrong" role
// (e.g. they're the approver but it hasn't been authorized yet) — that's `null`, not pending or history.
type RowState =
  | { kind: 'pending'; role: 'authorizer' | 'approver'; primary: 'authorize' | 'approve'; cancellation?: false }
  | { kind: 'pending'; role: 'authorizer' | 'approver'; cancellation: true }
  | { kind: 'history' }
  | null;

function rowStateFor(row: LeaveRow, empId: number): RowState {
  const isAuthorizer = row.ISAutherizedby === empId;
  const isApprover = row.APPROVEDBY === empId;
  if (!isAuthorizer && !isApprover) return null;

  // Pending conditions are checked across BOTH roles before either role's history fallback — when
  // the same person is configured as both authorizer and approver (the auto-approve-shortcut case),
  // a pending CancellationOfApproved review (the approver's job) must win over the authorizer's
  // broader history bucket, which also lists that status as one of ITS resolved end states.
  if (isAuthorizer && row.LEAVESTATUS === 'Applied') return { kind: 'pending', role: 'authorizer', primary: 'authorize' };
  if (isAuthorizer && row.LEAVESTATUS === 'CancellationOfAuthorized') return { kind: 'pending', role: 'authorizer', cancellation: true };
  if (isApprover && row.LEAVESTATUS === 'Authorized' && !row.APPROVED_date) return { kind: 'pending', role: 'approver', primary: 'approve' };
  if (isApprover && row.LEAVESTATUS === 'CancellationOfApproved') return { kind: 'pending', role: 'approver', cancellation: true };

  const historyStatuses = ['Authorized', 'Rejected', 'Approved', 'CancellationOfAuthorized', 'CancellationOfApproved', 'Cancelled', 'CancelledByAdmin'];
  if (historyStatuses.includes(row.LEAVESTATUS)) return { kind: 'history' };

  // Anything else (e.g. legacy's stray "Can not Apply..." bulk-upload failure rows) isn't a real
  // approval-relevant state for either role — leave it out of both tabs rather than showing junk.
  return null;
}

const thS: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontWeight: 700, fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', background: 'var(--bg-page)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.3px' };
const tdS: React.CSSProperties = { padding: '11px 14px', fontSize: 13, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' };
const btnSm = (bg: string, color: string): React.CSSProperties => ({ padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: bg, color });

function StatusChip({ status }: { status: string }) {
  const s = STATUS_COLOR[status] || { bg: '#f3f4f6', color: '#374151' };
  return <span style={{ ...s, padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, display: 'inline-block' }}>{STATUS_LABEL[status] ?? status}</span>;
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

type Action = 'authorize' | 'approve' | 'reject' | 'confirmCancellation' | 'rejectCancellation';

const ACTION_ENDPOINT: Record<Action, string> = {
  authorize: 'authorize',
  approve: 'approve',
  reject: 'reject',
  confirmCancellation: 'cancellation/approve',
  rejectCancellation: 'cancellation/reject',
};

function RemarkModal({ row, action, onClose, onDone }: { row: LeaveRow; action: Action; onClose: () => void; onDone: () => void }) {
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labels: Record<Action, string> = {
    authorize: 'Authorize', approve: 'Approve', reject: 'Reject',
    confirmCancellation: 'Confirm Cancellation', rejectCancellation: 'Reject Cancellation',
  };
  const colors: Record<Action, string> = {
    authorize: '#1d4ed8', approve: '#16a34a', reject: '#dc2626',
    confirmCancellation: '#dc2626', rejectCancellation: '#1d4ed8',
  };
  const needsRemark = action === 'reject';

  async function submit() {
    if (needsRemark && !remark.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leave/requests/${row.LEAVEENTRYID}/${ACTION_ENDPOINT[action]}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remarks: remark }),
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
          {needsRemark ? 'Reason for rejection *' : 'Remarks (optional)'}
        </label>
        <textarea
          value={remark} onChange={(e) => setRemark(e.target.value)} rows={3}
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)', fontSize: 13, resize: 'vertical' }}
          placeholder={needsRemark ? 'Enter reason...' : 'Add a remark...'}
        />
        {error && <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSm('var(--bg-page)', 'var(--text-muted)')}>Cancel</button>
          <button onClick={submit} disabled={loading || (needsRemark && !remark.trim())} style={btnSm(colors[action], '#fff')}>{loading ? '…' : labels[action]}</button>
        </div>
      </div>
    </div>
  );
}

// The employee who initiated this cancellation already went through .../requests/[id]/cancel — this
// modal is the authorizer/approver's review step, confirming the cancellation (-> Cancelled, balance
// restored) or rejecting it (reverts to Authorized/Approved, leave stays active). Ports legacy
// grandLeave()'s 'Approve Cancellation'/'Authorize Cancellation' branches; matches the admin
// (dashboard)/leave/requests page's cancellation/approve + cancellation/reject actions.
function CancellationModal({ row, action, onClose, onDone }: { row: LeaveRow; action: 'confirm' | 'reject'; onClose: () => void; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpoint = action === 'confirm' ? 'cancellation/approve' : 'cancellation/reject';
  const label = action === 'confirm' ? 'Confirm Cancellation' : 'Keep Leave Active';
  const color = action === 'confirm' ? '#16a34a' : '#dc2626';

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leave/requests/${row.LEAVEENTRYID}/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
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
        <h3 style={{ margin: '0 0 6px', color: BRAND, fontSize: 16, fontWeight: 800 }}>
          {action === 'confirm' ? 'Confirm Leave Cancellation' : 'Reject Leave Cancellation'}
        </h3>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-muted)' }}>
          {row.first_name} {row.last_name} · {row.leave_type} · {row.FROMDATE.slice(0, 10)} – {row.TODATE.slice(0, 10)} ({row.leave_days}d)
        </p>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-primary)' }}>
          {action === 'confirm'
            ? 'This cancels the leave and restores the employee’s leave balance.'
            : 'This keeps the leave active as-is and dismisses the cancellation request.'}
        </p>
        {error && <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSm('var(--bg-page)', 'var(--text-muted)')}>Back</button>
          <button onClick={submit} disabled={loading} style={btnSm(color, '#fff')}>{loading ? '…' : label}</button>
        </div>
      </div>
    </div>
  );
}

// ── REGULARISATION HIERARCHY QUEUE ─────────────────────────────────────────────
interface RegRow {
  id: number; att_date: string; direction: 'in' | 'out'; remarks: string | null; LOGTIME: string;
  approved: 'P' | 'A' | 'R'; first_name: string; last_name: string; emp_id: string;
}

const REG_STATUS_STYLE: Record<RegRow['approved'], { bg: string; color: string }> = {
  A: { bg: '#f0fdf4', color: '#166534' },
  R: { bg: '#fef2f2', color: '#991b1b' },
  P: { bg: '#fefce8', color: '#854d0e' },
};
const REG_STATUS_LABEL: Record<RegRow['approved'], string> = { A: 'Approved', R: 'Rejected', P: 'Pending' };

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function RegularisationApprovalsTab() {
  // Regularisation is single-stage (P -> A or P -> R, no separate Authorize step like leave —
  // confirmed by RegularisationController::listhierarchyregularization(), which only ever supports
  // a flat `regStatus` filter over approved IN ('P','A','R')), so the hierarchy queue here only
  // needs Pending / Approved — no "Authorized" tab exists for this feature at all.
  const [subTab, setSubTab] = useState<'pending' | 'approved'>('pending');
  const [rows, setRows] = useState<RegRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const month = currentMonth();

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/attendance/regularisation?month=${month}&scope=hierarchy&status=${subTab}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => setRows(d.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [month, subTab]);

  useEffect(() => { load(); }, [load]);

  async function decide(id: number, decision: 'approve' | 'reject') {
    setBusyId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/attendance/regularisation/${id}/decide`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Action failed');
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <AppTabs
          compact
          active={subTab}
          onChange={(k) => setSubTab(k as 'pending' | 'approved')}
          tabs={[
            { key: 'pending', label: 'Pending' },
            { key: 'approved', label: 'Approved' },
          ]}
        />
      </div>
      <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
        {message && <div style={{ padding: '10px 16px', fontSize: 12, color: '#dc2626', borderBottom: '1px solid var(--border)' }}>{message}</div>}
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {subTab === 'pending' ? "No pending regularisation requests — you're all caught up!" : 'No approved regularisation requests yet.'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Employee', 'Date', 'Direction', 'Time', 'Remarks', 'Status'].map((h) => <th key={h} style={thS}>{h}</th>)}
                  {subTab === 'pending' && <th style={{ ...thS, textAlign: 'center' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td style={tdS}>
                      <div style={{ fontWeight: 700 }}>{row.first_name} {row.last_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.emp_id}</div>
                    </td>
                    <td style={tdS}>{row.att_date}</td>
                    <td style={{ ...tdS, textTransform: 'capitalize' }}>{row.direction}</td>
                    <td style={tdS}>{row.LOGTIME}</td>
                    <td style={{ ...tdS, color: 'var(--text-muted)' }}>{row.remarks || '—'}</td>
                    <td style={tdS}>
                      <span style={{ ...REG_STATUS_STYLE[row.approved], padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, display: 'inline-block' }}>
                        {REG_STATUS_LABEL[row.approved]}
                      </span>
                    </td>
                    {subTab === 'pending' && (
                      <td style={{ ...tdS, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          <button disabled={busyId === row.id} style={btnSm('#16a34a', '#fff')} onClick={() => decide(row.id, 'approve')}>Approve</button>
                          <button disabled={busyId === row.id} style={btnSm('#dc2626', '#fff')} onClick={() => decide(row.id, 'reject')}>Reject</button>
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
    </div>
  );
}

export default function EssApprovalsPage() {
  const { data: session } = useSession();
  const empId = session?.user.empFkey;

  const [category, setCategory] = useState<'leave' | 'regularisation'>('leave');
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ row: LeaveRow; action: 'authorize' | 'approve' | 'reject' } | null>(null);
  const [cancelModal, setCancelModal] = useState<{ row: LeaveRow; action: 'confirm' | 'reject' } | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const load = useCallback(() => {
    if (!empId) return;
    fetch(`/api/leave/requests?authorizerFkey=${empId}&approverFkey=${empId}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => setRows(d.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [empId]);

  useEffect(() => { load(); }, [load]);

  // Same role split as the admin (dashboard)/leave/requests page: a row only ever shows up in
  // Pending for whichever of authorizer/approver must act on it next, and in History once that
  // viewer's part is done — never both, and not at all if it's not yet relevant to their role.
  const withState = rows
    .map((row) => ({ row, state: empId ? rowStateFor(row, empId) : null }))
    .filter((x): x is { row: LeaveRow; state: NonNullable<RowState> } => x.state !== null);
  const filtered = withState.filter((x) => (tab === 'pending' ? x.state.kind === 'pending' : x.state.kind === 'history'));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function changeTab(k: string) {
    setTab(k as 'pending' | 'history');
    setPage(1);
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Approvals</h1>
          <p className="page-subtitle">Leave requests and cancellations waiting on your authorization or approval</p>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <AppTabs
          active={category}
          onChange={(k) => setCategory(k as 'leave' | 'regularisation')}
          tabs={[
            { key: 'leave', label: 'Leave' },
            { key: 'regularisation', label: 'Regularisation' },
          ]}
        />
      </div>

      {category === 'regularisation' ? (
        <RegularisationApprovalsTab />
      ) : (
      <>
      <div style={{ marginBottom: 20 }}>
        <AppTabs
          active={tab}
          onChange={changeTab}
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
                  <th style={thS}>Sl.No</th>
                  {['Employee', 'Leave Type', 'From', 'To', 'Days', 'Applied On', 'Status'].map((h) => <th key={h} style={thS}>{h}</th>)}
                  {tab === 'pending' && <th style={{ ...thS, textAlign: 'center' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ row, state }, i) => (
                  <tr key={row.LEAVEENTRYID}>
                    <td style={tdS}>{(page - 1) * PAGE_SIZE + i + 1}</td>
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
                    {tab === 'pending' && state.kind === 'pending' && (
                      <td style={{ ...tdS, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                          {state.cancellation ? (
                            <>
                              <button style={btnSm('#16a34a', '#fff')} onClick={() => setCancelModal({ row, action: 'confirm' })}>Confirm Cancellation</button>
                              <button style={btnSm('#dc2626', '#fff')} onClick={() => setCancelModal({ row, action: 'reject' })}>Keep Leave</button>
                            </>
                          ) : (
                            <>
                              <button style={btnSm(state.primary === 'authorize' ? '#1d4ed8' : '#16a34a', '#fff')} onClick={() => setModal({ row, action: state.primary })}>
                                {state.primary === 'authorize' ? 'Authorize' : 'Approve'}
                              </button>
                              <button style={btnSm('#dc2626', '#fff')} onClick={() => setModal({ row, action: 'reject' })}>Reject</button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <EssPagination page={page} pageSize={PAGE_SIZE} totalItems={filtered.length} onChange={setPage} />
      </div>

      {modal && <RemarkModal row={modal.row} action={modal.action} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {cancelModal && <CancellationModal row={cancelModal.row} action={cancelModal.action} onClose={() => setCancelModal(null)} onDone={() => { setCancelModal(null); load(); }} />}
      </>
      )}
    </div>
  );
}
