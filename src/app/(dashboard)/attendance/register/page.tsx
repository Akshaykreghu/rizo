'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSetupOptions } from '@/lib/setupOptions';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { AttendanceGrid, type AttendanceDay, type AttendanceRow } from '@/components/attendance/AttendanceGrid';
import { ATTENDANCE_LEGEND, getCellColor } from '@/lib/attendance';
import { cn } from '@/lib/utils';
import { ShieldCheck, ShieldOff, X, Clock, Timer, LogIn, LogOut, Lock, Plus, Layers, Eye, EyeOff, BadgeCheck } from 'lucide-react';

const useLookup = useSetupOptions;

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface LeaveOption {
  salary_head_item_fkey: number;
  code: string;
  isIndirect: boolean;
  balance: number;
}

interface DayPunch {
  device_attandance_seq: number;
  LOGDATE: string;
  direction: string;
}

interface DayExtras {
  attDate: string;
  locked: boolean;
  punches: DayPunch[];
  otEligible: boolean;
  ot: { otDurationMin: number | null; setDurationMin: number | null; remarks: string | null; isManual: boolean } | null;
}

export default function AttendanceRegisterPage() {
  const [month, setMonth] = useState(currentMonth());
  const [branch, setBranch] = useState('');
  const [tab, setTab] = useState<'unverified' | 'verified'>('unverified');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [editCell, setEditCell] = useState<{ row: AttendanceRow; dayIndex: number; day: AttendanceDay } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showBulkUpdate, setShowBulkUpdate] = useState(false);
  const [showSummaryCols, setShowSummaryCols] = useState(true);
  const { slotEl } = useHeaderSlot();

  const { data: branches = [] } = useLookup('setup/branches', 'branch_code', (r) => String(r.branch_name));

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['attendance-register', month, branch, tab],
    queryFn: () =>
      fetch(`/api/attendance/register?month=${month}&branch=${branch}&status=${tab}`).then((r) => r.json()),
    enabled: !!branch,
  });

  const rows: AttendanceRow[] = data?.data ?? [];
  const monthlyOtVerifiedCount = rows.filter((r) => r.monthlyOt?.isVerified).length;
  const monthlyOtPendingCount = rows.length - monthlyOtVerifiedCount;

  const process = useMutation({
    mutationFn: () =>
      fetch('/api/attendance/register/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch, month }),
      }).then((r) => r.json()),
    onSuccess: (result) => {
      setMessage(result.message ?? 'Processed');
      refetch();
    },
  });

  const verify = useMutation({
    mutationFn: () =>
      fetch('/api/attendance/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registerIds: Array.from(selected) }),
      }).then((r) => r.json()),
    onSuccess: (result) => {
      setSelected(new Set());
      if (result.skipped?.length) {
        setMessage(`Verified ${result.verified.length}, skipped ${result.skipped.length}: ${result.skipped.map((s: { reason: string }) => s.reason).join('; ')}`);
      } else {
        setMessage(`Verified ${result.verified.length} employee(s)`);
      }
      refetch();
    },
  });

  const unverify = useMutation({
    mutationFn: () =>
      fetch('/api/attendance/register/unverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registerIds: Array.from(selected) }),
      }).then((r) => r.json()),
    onSuccess: (result) => {
      setSelected(new Set());
      if (result.skipped?.length) {
        setMessage(`Un-verified ${result.removed.length}, skipped ${result.skipped.length}: ${result.skipped.map((s: { reason: string }) => s.reason).join('; ')}`);
      } else {
        setMessage(`Un-verified ${result.removed.length} employee(s)`);
      }
      refetch();
    },
  });

  const saveMonthlyOtMutation = useMutation({
    mutationFn: (vars: { empFkey: number; setDurationMin: number }) =>
      fetch('/api/attendance/register/monthly-ot', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empFkey: vars.empFkey, month, setDurationMin: vars.setDurationMin }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to save Monthly OT');
        return body;
      }),
    onSuccess: () => {
      setMessage('Monthly OT saved');
      refetch();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const verifyMonthlyOt = useMutation({
    mutationFn: () =>
      fetch('/api/attendance/overtime/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month,
          employees: rows
            .filter((r) => selected.has(r.registerId))
            .map((r) => ({ emp_fkey: r.empFkey, set_duration_min: r.monthlyOt?.effectiveMin })),
        }),
      }).then((r) => r.json()),
    onSuccess: () => {
      // No toast here — the persistent "Monthly OT: N verified · M pending" status banner below
      // the tabs reflects this immediately once refetch() brings back the updated rows.
      setSelected(new Set());
      refetch();
    },
  });

  const editCellMutation = useMutation({
    mutationFn: (vars: { statusType: 'first' | 'second' | 'full'; status: string; salaryHeadItemFkey?: number }) =>
      fetch(`/api/attendance/register/${editCell!.row.registerId}/day/${editCell!.dayIndex}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to update');
        return body;
      }),
    // No refetch() here — DayEditor's handleSave calls onSaved() (wired to refetch below) exactly
    // once after every successful save, whether it touched status, OT, or both, so this mutation's
    // own onSuccess doesn't need to duplicate it.
  });

  const toggleSelect = (registerId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(registerId)) next.delete(registerId);
      else next.add(registerId);
      return next;
    });
  };

  return (
    <div>
      {/* Page title sits in the global Header row, left-aligned with this content, alongside the account controls. */}
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Attendance Register
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Review and manage employee attendance records
            </p>
          </div>,
          slotEl
        )}

      {/* Toolbar */}
      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <label className="text-[11.5px] font-medium text-slate-500">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[11.5px] font-medium text-slate-500">Branch</label>
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] min-w-[160px] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors"
          >
            <option value="">Select branch</option>
            {branches.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <button
          onClick={() => process.mutate()}
          disabled={!branch || process.isPending}
          className="flex items-center bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] disabled:opacity-50 text-white px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors"
        >
          {process.isPending ? 'Processing…' : 'Process'}
        </button>
        {tab === 'unverified' ? (
          <button
            onClick={() => verify.mutate()}
            disabled={selected.size === 0 || verify.isPending}
            className="flex items-center gap-1.5 bg-[color:var(--color-success)] hover:bg-[color:var(--color-success-dark)] disabled:opacity-50 text-white px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5" /> {verify.isPending ? 'Verifying…' : 'Verify'}
          </button>
        ) : (
          <button
            onClick={() => unverify.mutate()}
            disabled={selected.size === 0 || unverify.isPending}
            className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-[color:var(--color-danger-light)] hover:border-[color:var(--color-danger)]/30 hover:text-[color:var(--color-danger-dark)] disabled:opacity-50 text-slate-600 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold transition-colors"
          >
            <ShieldOff className="w-3.5 h-3.5" /> {unverify.isPending ? 'Un-verifying…' : 'Un-verify'}
          </button>
        )}
        {tab === 'unverified' && (
          <button
            onClick={() => setShowBulkUpdate(true)}
            disabled={selected.size === 0}
            className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-[color:var(--color-primary-light)] hover:border-[color:var(--color-primary)]/30 hover:text-[color:var(--color-primary)] disabled:opacity-50 text-slate-600 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold transition-colors"
          >
            <Layers className="w-3.5 h-3.5" /> Bulk Update{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        )}
        {tab === 'verified' && (
          <button
            onClick={() => verifyMonthlyOt.mutate()}
            disabled={selected.size === 0 || verifyMonthlyOt.isPending}
            className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-[color:var(--color-accent-light)] hover:border-[color:var(--color-accent)]/30 hover:text-[color:var(--color-accent-dark)] disabled:opacity-50 text-slate-600 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold transition-colors"
          >
            <BadgeCheck className="w-3.5 h-3.5" /> {verifyMonthlyOt.isPending ? 'Verifying…' : 'Verify Monthly OT'}{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 ml-auto pl-3 border-l border-slate-200 self-center">
          {ATTENDANCE_LEGEND.map((l) => (
            <span key={l.code} className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: l.bg }} />
              <span className="font-semibold text-slate-700">{l.code}</span>
              <span>{l.label}</span>
            </span>
          ))}
        </div>
      </div>

      {message && (
        <div className="mb-3 text-[12.5px] font-medium bg-[color:var(--color-primary-light)] text-[color:var(--color-primary-dark)] px-3.5 py-2 rounded-lg">
          {message}
        </div>
      )}

      {/* Table toolbar: status tabs + column visibility + Monthly OT status, tightly attached to the grid below */}
      <div className="flex flex-wrap items-center gap-2 pb-2 mb-2 border-b border-slate-200">
        <div className="inline-flex items-center bg-slate-100 rounded-lg p-0.5">
          <button
            onClick={() => { setTab('unverified'); setSelected(new Set()); }}
            className={cn(
              'px-3 py-1 rounded-md text-[12.5px] font-medium transition-colors',
              tab === 'unverified' ? 'bg-white text-[color:var(--color-primary)] shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            Not Verified
          </button>
          <button
            onClick={() => { setTab('verified'); setSelected(new Set()); }}
            className={cn(
              'px-3 py-1 rounded-md text-[12.5px] font-medium transition-colors',
              tab === 'verified' ? 'bg-white text-[color:var(--color-primary)] shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            Verified
          </button>
        </div>
        <button
          onClick={() => setShowSummaryCols((v) => !v)}
          className="flex items-center gap-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 px-3 py-1 rounded-lg text-[12.5px] font-medium transition-colors"
        >
          {showSummaryCols ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {showSummaryCols ? 'Hide Summary Columns' : 'Show Summary Columns'}
        </button>

        {tab === 'verified' && rows.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-[12.5px] text-slate-500">
            <BadgeCheck className="w-3.5 h-3.5 text-[color:var(--color-primary)]" />
            <span>
              Monthly OT: <span className="font-semibold text-slate-700">{monthlyOtVerifiedCount}</span> verified · <span className="font-semibold text-slate-700">{monthlyOtPendingCount}</span> pending
            </span>
            {monthlyOtVerifiedCount > 0 && (
              <button
                onClick={() => setSelected(new Set(rows.filter((r) => r.monthlyOt?.isVerified).map((r) => r.registerId)))}
                className="font-medium text-[color:var(--color-primary)] hover:underline underline-offset-2"
              >
                View verified
              </button>
            )}
          </div>
        )}
      </div>

      {!branch && <p className="text-sm text-slate-400">Select a branch to view attendance.</p>}
      {branch && isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {branch && !isLoading && rows.length === 0 && <p className="text-sm text-slate-400">No records for this month/branch. Try Process first.</p>}
      {branch && rows.length > 0 && (
        <AttendanceGrid
          key={`${month}-${branch}-${tab}`}
          rows={rows}
          selected={selected}
          onToggleSelect={toggleSelect}
          onCellClick={tab === 'unverified' ? (row, dayIndex, day) => setEditCell({ row, dayIndex, day }) : undefined}
          expandedRow={expandedRow}
          onToggleExpand={(id) => setExpandedRow((prev) => (prev === id ? null : id))}
          readOnly={tab === 'verified'}
          showSummaryCols={showSummaryCols}
          showMonthlyOt={tab === 'verified'}
          onMonthlyOtSave={
            tab === 'verified'
              ? (row, minutes) => saveMonthlyOtMutation.mutate({ empFkey: row.empFkey, setDurationMin: minutes })
              : undefined
          }
        />
      )}

      {editCell && (
        <DayEditor
          key={`${editCell.row.registerId}-${editCell.dayIndex}`}
          editCell={editCell}
          onClose={() => setEditCell(null)}
          saveStatus={(statusType, status, salaryHeadItemFkey) =>
            editCellMutation.mutateAsync({ statusType, status, salaryHeadItemFkey })
          }
          statusSaving={editCellMutation.isPending}
          onMessage={setMessage}
          onSaved={refetch}
        />
      )}

      {showBulkUpdate && (
        <BulkUpdateModal
          rows={rows.filter((r) => selected.has(r.registerId))}
          onClose={() => setShowBulkUpdate(false)}
          onDone={(msg) => {
            setShowBulkUpdate(false);
            setSelected(new Set());
            setMessage(msg);
            refetch();
          }}
        />
      )}
    </div>
  );
}

const HALVES = [
  { key: 'first', label: 'First Half', codes: ['P', 'LOP'] },
  { key: 'second', label: 'Second Half', codes: ['P', 'LOP', 'WO'] },
  { key: 'full', label: 'Full Day', codes: ['P/P', 'HO', 'WO', 'LOP/LOP'] },
] as const;

type HalfKey = (typeof HALVES)[number]['key'];

// Presentational only — turns a status's exact business color (from getCellColor) into a soft tint
// for the modal's chip backgrounds, without altering the underlying hex value itself.
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Parses a plain 'YYYY-MM-DD' as a local date (avoids the UTC-parse/local-render day-shift bug
// that `new Date(isoString)` + toLocaleDateString can produce near midnight).
function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
}

interface PendingStatus {
  half: HalfKey;
  status: string;
  salaryHeadItemFkey?: number;
}

function DayEditor({
  editCell, onClose, saveStatus, statusSaving, onMessage, onSaved,
}: {
  editCell: { row: AttendanceRow; dayIndex: number; day: AttendanceDay };
  onClose: () => void;
  saveStatus: (statusType: HalfKey, status: string, salaryHeadItemFkey?: number) => Promise<unknown>;
  statusSaving: boolean;
  onMessage: (msg: string) => void;
  /** Called once after a successful save so the parent grid (which this modal never talks to
   * directly) can refetch — status edits already trigger the grid's own refetch via saveStatus's
   * mutation, but an OT-only edit (no status change) previously left the grid showing stale data
   * until something else happened to refetch it. */
  onSaved: () => void;
}) {
  const { registerId } = editCell.row;
  const { dayIndex } = editCell;
  const [half, setHalf] = useState<HalfKey>('full');
  const [pendingStatus, setPendingStatus] = useState<PendingStatus | null>(null);

  const { data: leaveOptionsData } = useQuery<{ options: LeaveOption[] }>({
    queryKey: ['attendance-leave-options', registerId],
    queryFn: () => fetch(`/api/attendance/register/${registerId}/leave-options`).then((r) => r.json()),
  });
  const leaveOptions = leaveOptionsData?.options ?? [];

  const { data: extras, refetch: refetchExtras } = useQuery<DayExtras>({
    queryKey: ['attendance-day-extras', registerId, dayIndex],
    queryFn: () => fetch(`/api/attendance/register/${registerId}/day/${dayIndex}/extras`).then((r) => r.json()),
  });

  const [punchTime, setPunchTime] = useState('');
  const [punchDirection, setPunchDirection] = useState<'in' | 'out'>('in');
  // null = no user edit yet, fall back to the server's current value once `extras` loads.
  const [otValueOverride, setOtValueOverride] = useState<string | null>(null);
  const [otRemarkOverride, setOtRemarkOverride] = useState<string | null>(null);
  const otValue = otValueOverride ?? (extras?.ot?.setDurationMin != null ? String(extras.ot.setDurationMin) : '');
  const otRemark = otRemarkOverride ?? (extras?.ot?.remarks ?? '');

  const addPunchMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/attendance/register/${registerId}/day/${dayIndex}/punches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logTime: punchTime, direction: punchDirection }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to add punch');
        return body;
      }),
    onSuccess: () => { setPunchTime(''); refetchExtras(); },
    onError: (err: Error) => onMessage(err.message),
  });

  const saveOtMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/attendance/register/${registerId}/day/${dayIndex}/ot`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: otValue === '' ? '' : Number(otValue), remark: otRemark }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to save overtime');
        return body;
      }),
    onSuccess: () => { refetchExtras(); },
  });

  const locked = !!extras?.locked;
  const currentColor = getCellColor(editCell.day.value ?? '', false);
  const activeHalf = HALVES.find((h) => h.key === half)!;
  const otDirty = otValueOverride !== null || otRemarkOverride !== null;
  const hasChanges = !!pendingStatus || (!!extras?.otEligible && otDirty);
  const saving = statusSaving || saveOtMutation.isPending;

  const handleSave = async () => {
    try {
      if (pendingStatus) {
        await saveStatus(pendingStatus.half, pendingStatus.status, pendingStatus.salaryHeadItemFkey);
      }
      if (extras?.otEligible && otDirty) {
        await saveOtMutation.mutateAsync();
      }
      onMessage('Saved');
      onSaved();
      onClose();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-0 sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full h-full sm:h-auto sm:max-w-[560px] sm:max-h-[88vh] rounded-none sm:rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] flex flex-col overflow-hidden animate-modal-in"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-7 pt-7 pb-5 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-[21px] leading-tight font-semibold text-[#1D1D1F] tracking-tight truncate">
              {editCell.row.empName}
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="text-[13px] text-[#6E6E73]">{formatDisplayDate(editCell.day.date)}</span>
              <span
                className="text-[11px] font-semibold px-2 py-[3px] rounded-[6px]"
                style={{ backgroundColor: hexToRgba(currentColor.bg, 0.14), color: currentColor.bg }}
              >
                {editCell.day.value || 'Not set'}
              </span>
              {locked && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-[3px] rounded-[6px]">
                  <Lock className="w-3 h-3" /> Verified
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#86868B] hover:text-[#1D1D1F] hover:bg-black/[0.05] active:scale-95 transition-all duration-150 flex-shrink-0"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto scroll-fade flex-1">
          {/* Status */}
          <section className="px-7 pb-6">
            <div className="flex bg-[#F5F5F7] rounded-[10px] p-[3px] mb-4">
              {HALVES.map((h) => (
                <button
                  key={h.key}
                  onClick={() => setHalf(h.key)}
                  className={cn(
                    'flex-1 text-[13px] font-medium py-[7px] rounded-[8px] transition-all duration-200',
                    half === h.key ? 'bg-white text-[#1D1D1F] shadow-[0_1px_3px_rgba(0,0,0,0.1)]' : 'text-[#6E6E73] hover:text-[#1D1D1F]'
                  )}
                >
                  {h.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {activeHalf.codes.map((c) => {
                const color = getCellColor(c, false);
                const isSelected = pendingStatus?.half === half && pendingStatus?.status === c;
                return (
                  <button
                    key={c}
                    onClick={() => setPendingStatus({ half, status: c })}
                    disabled={statusSaving}
                    className="text-[13px] font-medium px-3.5 py-[7px] rounded-[9px] border disabled:opacity-40 transition-all duration-150"
                    style={{
                      backgroundColor: hexToRgba(color.bg, isSelected ? 0.16 : 0.08),
                      color: color.bg,
                      borderColor: isSelected ? hexToRgba(color.bg, 0.5) : 'transparent',
                    }}
                  >
                    {c}
                  </button>
                );
              })}
              {leaveOptions.map((lo) => {
                const isSelected = pendingStatus?.half === half && pendingStatus?.status === lo.code;
                return (
                  <button
                    key={lo.salary_head_item_fkey}
                    onClick={() => setPendingStatus({ half, status: lo.code, salaryHeadItemFkey: lo.salary_head_item_fkey })}
                    disabled={statusSaving || (!lo.isIndirect && lo.balance <= 0)}
                    className="text-[13px] font-medium px-3.5 py-[7px] rounded-[9px] border disabled:opacity-40 transition-all duration-150"
                    style={{
                      backgroundColor: hexToRgba('#8b5cf6', isSelected ? 0.16 : 0.08),
                      color: '#7041d8',
                      borderColor: isSelected ? 'rgba(139, 92, 246, 0.5)' : 'transparent',
                    }}
                  >
                    {lo.code} <span className="opacity-60 font-normal">({lo.balance})</span>
                  </button>
                );
              })}
            </div>
            {pendingStatus && (
              <p className="text-[12.5px] text-[#6E6E73] mt-3">
                Will set {pendingStatus.half === 'first' ? 'first half' : pendingStatus.half === 'second' ? 'second half' : 'full day'} to{' '}
                <span className="font-semibold text-[#1D1D1F]">{pendingStatus.status}</span> on Save.
              </p>
            )}
          </section>

          {/* Punches */}
          <section className="px-7 py-6 border-t border-black/[0.06]">
            <div className="flex items-center gap-2 mb-3.5">
              <Clock className="w-[15px] h-[15px] text-[#86868B]" strokeWidth={2} />
              <h3 className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">Punches</h3>
            </div>
            {(extras?.punches?.length ?? 0) > 0 ? (
              <div className="space-y-1.5 mb-4">
                {extras!.punches.map((p) => {
                  const isIn = p.direction.toLowerCase() === 'in';
                  return (
                    <div key={p.device_attandance_seq} className="flex items-center justify-between px-3.5 py-2.5 rounded-[10px] bg-[#F5F5F7]">
                      <span className="flex items-center gap-2.5">
                        <span
                          className={cn(
                            'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0',
                            isIn ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)]' : 'bg-black/[0.06] text-[#6E6E73]'
                          )}
                        >
                          {isIn ? <LogIn className="w-3 h-3" /> : <LogOut className="w-3 h-3" />}
                        </span>
                        <span className="text-[13px] font-medium text-[#1D1D1F] capitalize">{p.direction}</span>
                      </span>
                      {/* DB connections read datetimes tagged as UTC (lib/db.ts timezone: '+00:00') though
                          the schema only ever stores naive local wall-clock time — timeZone: 'UTC' here
                          reads back the stored value verbatim instead of re-shifting by the browser's offset. */}
                      <span className="text-[13px] text-[#6E6E73] tabular-nums">
                        {new Date(p.LOGDATE).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[13px] text-[#86868B] mb-4">No punches recorded for this date.</p>
            )}
            {!locked && (
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  step="1"
                  value={punchTime}
                  onChange={(e) => setPunchTime(e.target.value)}
                  className="flex-1 h-11 px-3.5 rounded-[11px] border border-black/[0.08] bg-white text-[13px] text-[#1D1D1F] focus:outline-none focus:ring-[3px] focus:ring-[color:var(--color-primary)]/15 focus:border-[color:var(--color-primary)] transition-all duration-150"
                />
                <select
                  value={punchDirection}
                  onChange={(e) => setPunchDirection(e.target.value as 'in' | 'out')}
                  className="h-11 px-3 rounded-[11px] border border-black/[0.08] bg-white text-[13px] text-[#1D1D1F] focus:outline-none focus:ring-[3px] focus:ring-[color:var(--color-primary)]/15 focus:border-[color:var(--color-primary)] transition-all duration-150"
                >
                  <option value="in">In</option>
                  <option value="out">Out</option>
                </select>
                <button
                  onClick={() => addPunchMutation.mutate()}
                  disabled={!punchTime || addPunchMutation.isPending}
                  className="h-11 px-4 rounded-[11px] border border-black/[0.08] bg-white text-[13px] font-medium text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] active:scale-[0.98] disabled:opacity-40 transition-all duration-150 whitespace-nowrap flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> {addPunchMutation.isPending ? 'Adding…' : 'Add'}
                </button>
              </div>
            )}
          </section>

          {/* Overtime */}
          {extras?.otEligible && (
            <section className="px-7 py-6 border-t border-black/[0.06]">
              <div className="flex items-center justify-between mb-3.5">
                <div className="flex items-center gap-2">
                  <Timer className="w-[15px] h-[15px] text-[#86868B]" strokeWidth={2} />
                  <h3 className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">Overtime</h3>
                </div>
                {extras.ot?.otDurationMin != null && (
                  <span className="text-[11px] font-semibold text-[color:var(--color-primary)] bg-[color:var(--color-primary-soft)] px-2 py-[3px] rounded-[6px]">
                    {(extras.ot.otDurationMin / 60).toFixed(2)} hrs computed
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-medium text-[#6E6E73] mb-1.5">OT Minutes</label>
                  <input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={otValue}
                    onChange={(e) => setOtValueOverride(e.target.value)}
                    disabled={locked}
                    className="w-full h-11 px-3.5 rounded-[11px] border border-black/[0.08] bg-white text-[13px] text-[#1D1D1F] placeholder:text-[#86868B] focus:outline-none focus:ring-[3px] focus:ring-[color:var(--color-primary)]/15 focus:border-[color:var(--color-primary)] disabled:opacity-50 disabled:bg-[#F5F5F7] transition-all duration-150"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6E6E73] mb-1.5">Remarks</label>
                  <input
                    type="text"
                    placeholder="Add a remark…"
                    value={otRemark}
                    onChange={(e) => setOtRemarkOverride(e.target.value)}
                    disabled={locked}
                    className="w-full h-11 px-3.5 rounded-[11px] border border-black/[0.08] bg-white text-[13px] text-[#1D1D1F] placeholder:text-[#86868B] focus:outline-none focus:ring-[3px] focus:ring-[color:var(--color-primary)]/15 focus:border-[color:var(--color-primary)] disabled:opacity-50 disabled:bg-[#F5F5F7] transition-all duration-150"
                  />
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-7 py-5 border-t border-black/[0.06] flex-shrink-0">
          <button
            onClick={onClose}
            className="text-[14px] font-medium text-[#6E6E73] hover:text-[#1D1D1F] transition-colors duration-150"
          >
            Cancel
          </button>
          <div className="flex items-center gap-3">
            {saving && <span className="text-[12px] text-[#86868B]">Saving…</span>}
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="h-11 px-5 rounded-[11px] bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] active:scale-[0.98] disabled:opacity-40 text-white text-[14px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.1)] transition-all duration-150"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const BULK_STATUS_CODES = ['P/P', 'HO', 'WO', 'LOP/LOP'];

// Ports EditAttendanceController::bulkipdatestatus()'s intent (bulk-apply one status across many
// selected date rows for an employee) onto our multi-employee grid instead: select employee ROWS,
// then apply one status and/or one OT value across every day cell in each selected employee's month
// -- skipping any cell currently marked NA (unmapped/pre-joining/post-exit days), per explicit scope.
// Deliberately reuses the existing single-day status/OT endpoints per (employee, day) rather than a
// new bulk DB write path, so every existing rule (verified-month lock, leave-conflict check, OT
// insert/update logic) applies identically -- same trade-off already accepted for the Process button's
// per-employee x day loop: slower, but correct by construction instead of a second, parallel write path.
function BulkUpdateModal({
  rows, onClose, onDone,
}: {
  rows: AttendanceRow[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [otValue, setOtValue] = useState('');
  const [otRemark, setOtRemark] = useState('');
  const [running, setRunning] = useState(false);

  const hasChanges = !!status || otValue !== '';
  const totalDays = rows.reduce((sum, r) => sum + r.days.length, 0);

  const handleApply = async () => {
    setRunning(true);
    let skippedNA = 0;
    const tasks: Promise<boolean>[] = [];

    for (const row of rows) {
      row.days.forEach((day, i) => {
        if ((day.value ?? '').trim().toUpperCase() === 'NA') {
          skippedNA++;
          return;
        }
        const dayIndex = i + 1;
        if (status) {
          tasks.push(
            fetch(`/api/attendance/register/${row.registerId}/day/${dayIndex}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ statusType: 'full', status }),
            }).then((r) => r.ok).catch(() => false)
          );
        }
        if (otValue !== '') {
          tasks.push(
            fetch(`/api/attendance/register/${row.registerId}/day/${dayIndex}/ot`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ value: Number(otValue), remark: otRemark }),
            }).then((r) => r.ok).catch(() => false)
          );
        }
      });
    }

    const results = await Promise.all(tasks);
    const succeeded = results.filter(Boolean).length;
    const failed = results.length - succeeded;

    setRunning(false);
    onDone(
      `Bulk update applied: ${succeeded} write(s) succeeded across ${rows.length} employee(s)` +
      `${skippedNA ? `, ${skippedNA} NA day(s) skipped` : ''}` +
      `${failed ? `, ${failed} failed (verified/locked month or leave conflict)` : ''}.`
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={running ? undefined : onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-[440px] rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] animate-modal-in"
      >
        <div className="flex items-start justify-between gap-4 px-7 pt-7 pb-5">
          <div>
            <h2 className="text-[19px] font-semibold text-[#1D1D1F] tracking-tight">Bulk Update</h2>
            <p className="text-[13px] text-[#6E6E73] mt-1">
              {rows.length} employee{rows.length === 1 ? '' : 's'} selected, {totalDays} day-cells total (NA days are skipped)
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={running}
            aria-label="Close"
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#86868B] hover:text-[#1D1D1F] hover:bg-black/[0.05] disabled:opacity-40 transition-all duration-150 flex-shrink-0"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        <div className="px-7 pb-6">
          <label className="block text-[12px] font-medium text-[#6E6E73] mb-1.5">Status (applies to every non-NA day)</label>
          <div className="flex flex-wrap gap-2 mb-1">
            {BULK_STATUS_CODES.map((c) => {
              const color = getCellColor(c, false);
              const isSelected = status === c;
              return (
                <button
                  key={c}
                  onClick={() => setStatus(isSelected ? null : c)}
                  disabled={running}
                  className="text-[13px] font-medium px-3.5 py-[7px] rounded-[9px] border disabled:opacity-40 transition-all duration-150"
                  style={{
                    backgroundColor: hexToRgba(color.bg, isSelected ? 0.16 : 0.08),
                    color: color.bg,
                    borderColor: isSelected ? hexToRgba(color.bg, 0.5) : 'transparent',
                  }}
                >
                  {c}
                </button>
              );
            })}
          </div>
          <p className="text-[12px] text-[#86868B]">Leave codes aren&apos;t offered here, balances/policy vary per employee -- use the day-cell editor for those.</p>
        </div>

        <div className="px-7 pb-6 border-t border-black/[0.06] pt-6">
          <div className="flex items-center gap-2 mb-3.5">
            <Timer className="w-[15px] h-[15px] text-[#86868B]" strokeWidth={2} />
            <h3 className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">Overtime (optional)</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-medium text-[#6E6E73] mb-1.5">OT Minutes</label>
              <input
                type="number"
                min={0}
                placeholder="Leave blank to skip"
                value={otValue}
                onChange={(e) => setOtValue(e.target.value)}
                disabled={running}
                className="w-full h-11 px-3.5 rounded-[11px] border border-black/[0.08] bg-white text-[13px] text-[#1D1D1F] placeholder:text-[#86868B] focus:outline-none focus:ring-[3px] focus:ring-[color:var(--color-primary)]/15 focus:border-[color:var(--color-primary)] disabled:opacity-50 transition-all duration-150"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#6E6E73] mb-1.5">Remarks</label>
              <input
                type="text"
                placeholder="Add a remark…"
                value={otRemark}
                onChange={(e) => setOtRemark(e.target.value)}
                disabled={running}
                className="w-full h-11 px-3.5 rounded-[11px] border border-black/[0.08] bg-white text-[13px] text-[#1D1D1F] placeholder:text-[#86868B] focus:outline-none focus:ring-[3px] focus:ring-[color:var(--color-primary)]/15 focus:border-[color:var(--color-primary)] disabled:opacity-50 transition-all duration-150"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-7 py-5 border-t border-black/[0.06]">
          <button
            onClick={onClose}
            disabled={running}
            className="text-[14px] font-medium text-[#6E6E73] hover:text-[#1D1D1F] disabled:opacity-40 transition-colors duration-150"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!hasChanges || running}
            className="h-11 px-5 rounded-[11px] bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] active:scale-[0.98] disabled:opacity-40 text-white text-[14px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.1)] transition-all duration-150"
          >
            {running ? 'Applying…' : 'Apply to Selected'}
          </button>
        </div>
      </div>
    </div>
  );
}
