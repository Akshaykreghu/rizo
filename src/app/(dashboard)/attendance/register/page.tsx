'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSetupOptions } from '@/lib/setupOptions';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { AttendanceGrid, type AttendanceDay, type AttendanceRow } from '@/components/attendance/AttendanceGrid';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { TimePicker, nowAsHHMMSS } from '@/components/ui/TimePicker';
import { ATTENDANCE_LEGEND, getCellColor, formatStatusDisplay } from '@/lib/attendance';
import { cn } from '@/lib/utils';
import { ShieldCheck, ShieldOff, X, Clock, Timer, LogIn, LogOut, Lock, Plus, Layers, Eye, EyeOff, BadgeCheck, Power, Pencil, Check } from 'lucide-react';

const useLookup = useSetupOptions;

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Matches legacy AttendanceRegisterNew's month filter: a dropdown of the last 38 calendar months
// (not a native calendar month-picker), newest first.
function recentMonthOptions(count = 38): { value: string; label: string }[] {
  const list: { value: string; label: string }[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < count; i++) {
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    list.push({ value, label: d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) });
    d.setMonth(d.getMonth() - 1);
  }
  return list;
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
  status: 'Y' | 'N';
}

interface DayExtras {
  attDate: string;
  locked: boolean;
  punches: DayPunch[];
  otEligible: boolean;
  ot: { otDurationMin: number | null; setDurationMin: number | null; remarks: string | null; isManual: boolean } | null;
  computedAttendance: { inTime: string | null; outTime: string | null; durationMin: number | null; present: string | null } | null;
}

function formatDurationMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// Renders a 24h "HH:MM:SS" (the TimePicker's own value format) as a 12h "hh:mm AM/PM" display string,
// matching how already-saved punches are displayed elsewhere in this modal.
function formatHHMMSS12(hhmmss: string): string {
  const [h, m] = hhmmss.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function AttendanceRegisterPage() {
  const [month, setMonth] = useState(currentMonth());
  const [branch, setBranch] = useState('');
  const [empFkey, setEmpFkey] = useState('');
  const [tab, setTab] = useState<'unverified' | 'verified'>('unverified');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [editCell, setEditCell] = useState<{ row: AttendanceRow; dayIndex: number; day: AttendanceDay } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showBulkUpdate, setShowBulkUpdate] = useState(false);
  const [showSummaryCols, setShowSummaryCols] = useState(true);
  const { slotEl } = useHeaderSlot();
  const monthOptions = useMemo(() => recentMonthOptions(), []);

  const { data: branches = [] } = useLookup('setup/branches', 'branch_code', (r) => String(r.branch_name));

  // Default to the first branch once the list loads, so the page opens with a populated view
  // instead of an empty "Select branch" state.
  useEffect(() => {
    if (!branch && branches.length > 0) setBranch(branches[0].value);
  }, [branch, branches]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['attendance-register', month, branch, tab],
    queryFn: () =>
      fetch(`/api/attendance/register?month=${month}&branch=${branch}&status=${tab}`).then((r) => r.json()),
    enabled: !!branch,
  });

  // Employee is optional — legacy's default is "ALL" (id 0), i.e. every employee in the selected
  // branch/month. When one is picked, scope the already-fetched branch/month rows down to it
  // client-side rather than adding a server round-trip, since /api/attendance/register already
  // returns the full branch for that month.
  const allRows: AttendanceRow[] = data?.data ?? [];
  const rows: AttendanceRow[] = empFkey ? allRows.filter((r) => String(r.empFkey) === empFkey) : allRows;
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
    // No refetch() here — DayEditor's unified handleSave calls onSaved() (wired to refetch below)
    // itself once, after committing whichever of Status/Punches/Overtime were actually dirty, so this
    // mutation's own onSuccess doesn't need to duplicate it.
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
          <SearchableSelect
            value={month}
            onChange={setMonth}
            options={monthOptions}
            placeholder="Select month"
            className="min-w-[150px]"
            buttonClassName="!py-1.5 !text-[12.5px] !rounded-[9px]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[11.5px] font-medium text-slate-500">Branch</label>
          <SearchableSelect
            value={branch}
            onChange={(v) => { setBranch(v); setEmpFkey(''); }}
            options={branches}
            placeholder="Select branch"
            className="min-w-[170px]"
            buttonClassName="!py-1.5 !text-[12.5px] !rounded-[9px]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[11.5px] font-medium text-slate-500">Employee</label>
          <EmployeeSearch
            value={empFkey}
            onChange={setEmpFkey}
            branch={branch}
            emptyLabel="All employees"
            className="!h-9 !text-[12.5px] min-w-[200px]"
          />
        </div>
        <div className="flex items-center gap-2 pl-1 border-l border-slate-200">
          <button
            onClick={() => process.mutate()}
            disabled={!branch || process.isPending}
            className="flex items-center bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] disabled:opacity-50 text-white px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors"
          >
            {process.isPending ? 'Processing…' : 'Process'}
          </button>
        </div>

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
        <div className="inline-flex items-center bg-slate-100 rounded-[10px] p-1">
          <button
            onClick={() => { setTab('unverified'); setSelected(new Set()); }}
            className={cn(
              'px-4 py-2 rounded-[8px] text-[13.5px] font-semibold transition-colors',
              tab === 'unverified' ? 'bg-white text-[color:var(--color-primary)] shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            Not Verified
          </button>
          <button
            onClick={() => { setTab('verified'); setSelected(new Set()); }}
            className={cn(
              'px-4 py-2 rounded-[8px] text-[13.5px] font-semibold transition-colors',
              tab === 'verified' ? 'bg-white text-[color:var(--color-primary)] shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            Verified
          </button>
        </div>
        <button
          onClick={() => setShowSummaryCols((v) => !v)}
          className="flex items-center gap-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 px-3 py-1.5 rounded-[9px] text-[12.5px] font-medium transition-colors"
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

      {/* Verify / Bulk Update live only inside the Not Verified tab's own content, not the shared
          tabs/toolbar row above. */}
      {tab === 'unverified' && (
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => verify.mutate()}
            disabled={selected.size === 0 || verify.isPending}
            className="flex items-center gap-1.5 bg-[color:var(--color-success)] hover:bg-[color:var(--color-success-dark)] disabled:opacity-50 text-white px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5" /> {verify.isPending ? 'Verifying…' : 'Verify'}
          </button>
          <button
            onClick={() => setShowBulkUpdate(true)}
            disabled={selected.size === 0}
            className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-[color:var(--color-primary-light)] hover:border-[color:var(--color-primary)]/30 hover:text-[color:var(--color-primary)] disabled:opacity-50 text-slate-600 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold transition-colors"
          >
            <Layers className="w-3.5 h-3.5" /> Bulk Update{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        </div>
      )}

      {/* Un-verify / Verify Monthly OT live only inside the Verified tab's own content. */}
      {tab === 'verified' && (
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => unverify.mutate()}
            disabled={selected.size === 0 || unverify.isPending}
            className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-[color:var(--color-danger-light)] hover:border-[color:var(--color-danger)]/30 hover:text-[color:var(--color-danger-dark)] disabled:opacity-50 text-slate-600 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold transition-colors"
          >
            <ShieldOff className="w-3.5 h-3.5" /> {unverify.isPending ? 'Un-verifying…' : 'Un-verify'}
          </button>
          <button
            onClick={() => verifyMonthlyOt.mutate()}
            disabled={selected.size === 0 || verifyMonthlyOt.isPending}
            className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-[color:var(--color-accent-light)] hover:border-[color:var(--color-accent)]/30 hover:text-[color:var(--color-accent-dark)] disabled:opacity-50 text-slate-600 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold transition-colors"
          >
            <BadgeCheck className="w-3.5 h-3.5" /> {verifyMonthlyOt.isPending ? 'Verifying…' : 'Verify Monthly OT'}{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        </div>
      )}

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
  // Bare codes, not pre-combined "X/X" — mergeHalfDayStatus (lib/attendance.ts) does the full-day
  // doubling itself (and the HO/WO bare-code exception), matching legacy's own chnagestatus() merge.
  // Passing an already-doubled string here would get doubled again ('P/P' -> 'P/P/P/P').
  { key: 'full', label: 'Full Day', codes: ['P', 'HO', 'WO', 'LOP'] },
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
  /** Called once after handleSave commits anything (Status/Punches/Overtime) so the parent grid
   * (which this modal never talks to directly) can refetch. */
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

  const [punchTime, setPunchTime] = useState(nowAsHHMMSS);
  const [punchDirection, setPunchDirection] = useState<'in' | 'out'>('in');
  // Punches the user has entered but not yet saved — collected here (rather than posted one at a
  // time) so a day needing both an "in" and an "out" punch can be filled in and committed together by
  // the one common Save button below, instead of needing a separate visit per punch.
  const [stagedPunches, setStagedPunches] = useState<{ time: string; direction: 'in' | 'out' }[]>([]);
  // null = no user edit yet, fall back to the server's current value once `extras` loads.
  const [otValueOverride, setOtValueOverride] = useState<string | null>(null);
  const [otRemarkOverride, setOtRemarkOverride] = useState<string | null>(null);
  const otValue = otValueOverride ?? (extras?.ot?.setDurationMin != null ? String(extras.ot.setDurationMin) : '');
  const otRemark = otRemarkOverride ?? (extras?.ot?.remarks ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const stagePunch = () => {
    // Light safeguard, not a hard block: warn if this exact time is already staged or already saved
    // for the day — a near-duplicate punch is exactly what previously confused the duration-computing
    // trigger into pairing the wrong in/out and reporting 0 minutes worked.
    const alreadyUsed =
      stagedPunches.some((p) => p.time === punchTime) ||
      (extras?.punches ?? []).some((p) => new Date(p.LOGDATE).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' }) === punchTime);
    if (alreadyUsed && !confirm('A punch already exists at this exact time — add anyway?')) return;

    setStagedPunches((prev) => [...prev, { time: punchTime, direction: punchDirection }]);
    setPunchTime(nowAsHHMMSS());
  };

  const postPunch = async (time: string, direction: 'in' | 'out') => {
    const res = await fetch(`/api/attendance/register/${registerId}/day/${dayIndex}/punches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logTime: time, direction }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? 'Failed to add punch');
    return body;
  };

  // Ports EditPunchesController::savepunch()'s inline status-checkbox editor (Y/N, "Active"/"Inactive")
  // instead of remove()'s hard status='D' delete — a punch is deactivated here, not deleted, so it
  // stays visible (badged) and can be reactivated, rather than disappearing permanently.
  const togglePunchActiveMutation = useMutation({
    mutationFn: (vars: { deviceAttandanceSeq: number; active: boolean }) =>
      fetch(`/api/attendance/register/${registerId}/day/${dayIndex}/punches`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to update punch');
        return body;
      }),
    onSuccess: () => { refetchExtras(); onSaved(); },
    onError: (err: Error) => onMessage(err.message),
  });

  // Which existing punch (by device_attandance_seq) is currently open for inline time/direction
  // editing — ports EditPunchesController::savepunch()'s in-place edit (an UPDATE keyed on the same
  // PK, not deactivate-old+insert-new).
  const [editingPunchSeq, setEditingPunchSeq] = useState<number | null>(null);
  const [editPunchTime, setEditPunchTime] = useState('');
  const [editPunchDirection, setEditPunchDirection] = useState<'in' | 'out'>('in');

  const editPunchMutation = useMutation({
    mutationFn: (vars: { deviceAttandanceSeq: number; logTime: string; direction: 'in' | 'out' }) =>
      fetch(`/api/attendance/register/${registerId}/day/${dayIndex}/punches`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to update punch');
        return body;
      }),
    onSuccess: () => { setEditingPunchSeq(null); refetchExtras(); onSaved(); },
    onError: (err: Error) => onMessage(err.message),
  });

  // mutateAsync's own rejection is what handleSave below reacts to, so this only needs to handle the
  // success side-effect (clearing the local override so `otValue`/`otRemark` fall back to reading the
  // freshly-saved server value once `extras` is refetched).
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
    onSuccess: () => { setOtValueOverride(null); setOtRemarkOverride(null); },
  });

  const locked = !!extras?.locked;
  const currentColor = getCellColor(editCell.day.value ?? '', false);
  const activeHalf = HALVES.find((h) => h.key === half)!;
  const otDirty = otValueOverride !== null || otRemarkOverride !== null;
  const hasChanges = !!pendingStatus || stagedPunches.length > 0 || otDirty;
  const saving = statusSaving || isSaving;

  // The one common Save action: commits only whatever's actually dirty (status / staged punches /
  // overtime), independently of each other, so one failing doesn't block the rest. On full success it
  // closes the modal; on a partial failure it stays open with only the failed part still pending, so
  // Save can just be clicked again to retry.
  const handleSave = async () => {
    setIsSaving(true);
    const successParts: string[] = [];
    const errorParts: string[] = [];
    let anySuccess = false;

    if (pendingStatus) {
      try {
        await saveStatus(pendingStatus.half, pendingStatus.status, pendingStatus.salaryHeadItemFkey);
        successParts.push('status saved');
        anySuccess = true;
        setPendingStatus(null);
      } catch (err) {
        errorParts.push(`status: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }

    if (stagedPunches.length > 0) {
      const stillPending: typeof stagedPunches = [];
      let addedCount = 0;
      // Sequential, not parallel — punches land one at a time, matching how they'd be entered for
      // real, and avoiding two same-second inserts racing the duration-computing trigger.
      for (const p of stagedPunches) {
        try {
          await postPunch(p.time, p.direction);
          addedCount++;
          anySuccess = true;
        } catch (err) {
          stillPending.push(p);
          errorParts.push(`${p.direction} punch at ${formatHHMMSS12(p.time)}: ${err instanceof Error ? err.message : 'failed'}`);
        }
      }
      if (addedCount > 0) successParts.push(`${addedCount} punch${addedCount === 1 ? '' : 'es'} added`);
      setStagedPunches(stillPending);
    }

    if (otDirty) {
      try {
        await saveOtMutation.mutateAsync();
        successParts.push('overtime saved');
        anySuccess = true;
      } catch (err) {
        errorParts.push(`overtime: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }

    setIsSaving(false);
    if (anySuccess) {
      refetchExtras();
      onSaved();
    }

    if (errorParts.length === 0) {
      onMessage(successParts.length ? `Saved — ${successParts.join(', ')}.` : 'Saved');
      onClose();
    } else {
      onMessage(
        `${successParts.length ? `Saved — ${successParts.join(', ')}. ` : ''}Failed — ${errorParts.join('; ')}.`
      );
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
                {formatStatusDisplay(editCell.day.value) || 'Not set'}
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
                    disabled={saving}
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
                    disabled={saving || (!lo.isIndirect && lo.balance <= 0)}
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
          </section>

          {/* Punches */}
          <section className="px-7 py-6 border-t border-black/[0.06]">
            <div className="flex items-center justify-between mb-3.5">
              <div className="flex items-center gap-2">
                <Clock className="w-[15px] h-[15px] text-[#86868B]" strokeWidth={2} />
                <h3 className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">Punches</h3>
              </div>
              {extras?.computedAttendance?.durationMin != null && (
                <span className="text-[11px] font-semibold text-[color:var(--color-success-dark)] bg-[color:var(--color-success-soft)] px-2 py-[3px] rounded-[6px]">
                  {formatDurationMin(extras.computedAttendance.durationMin)} worked
                </span>
              )}
            </div>
            {(extras?.punches?.length ?? 0) > 0 ? (
              <div className="space-y-1.5 mb-4">
                {extras!.punches.map((p) => {
                  const isIn = p.direction.toLowerCase() === 'in';
                  const isInactive = p.status === 'N';
                  const isEditing = editingPunchSeq === p.device_attandance_seq;
                  // DB connections read datetimes tagged as UTC (lib/db.ts timezone: '+00:00') though
                  // the schema only ever stores naive local wall-clock time — timeZone: 'UTC' here
                  // reads back the stored value verbatim instead of re-shifting by the browser's offset.
                  const currentHHMMSS = new Date(p.LOGDATE).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' });

                  if (isEditing) {
                    return (
                      <div key={p.device_attandance_seq} className="flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] bg-[color:var(--color-primary)]/[0.06] border border-[color:var(--color-primary)]/15">
                        <TimePicker value={editPunchTime} onChange={setEditPunchTime} disabled={editPunchMutation.isPending} className="flex-1" />
                        <select
                          value={editPunchDirection}
                          onChange={(e) => setEditPunchDirection(e.target.value as 'in' | 'out')}
                          disabled={editPunchMutation.isPending}
                          className="h-11 px-3 rounded-[11px] border border-black/[0.08] bg-white text-[13px] text-[#1D1D1F] focus:outline-none focus:ring-[3px] focus:ring-[color:var(--color-primary)]/15 focus:border-[color:var(--color-primary)] disabled:opacity-50 transition-all duration-150"
                        >
                          <option value="in">In</option>
                          <option value="out">Out</option>
                        </select>
                        <button
                          onClick={() => editPunchMutation.mutate({ deviceAttandanceSeq: p.device_attandance_seq, logTime: editPunchTime, direction: editPunchDirection })}
                          disabled={editPunchMutation.isPending}
                          aria-label="Save punch edit"
                          title="Save"
                          className="w-9 h-9 rounded-full flex items-center justify-center text-[color:var(--color-success-dark)] hover:bg-[color:var(--color-success-soft)] disabled:opacity-40 transition-colors duration-150 flex-shrink-0"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditingPunchSeq(null)}
                          disabled={editPunchMutation.isPending}
                          aria-label="Cancel punch edit"
                          title="Cancel"
                          className="w-9 h-9 rounded-full flex items-center justify-center text-[#86868B] hover:bg-black/[0.05] disabled:opacity-40 transition-colors duration-150 flex-shrink-0"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={p.device_attandance_seq}
                      className={cn(
                        'flex items-center justify-between px-3.5 py-2.5 rounded-[10px]',
                        isInactive ? 'bg-amber-50 border border-amber-200' : 'bg-[#F5F5F7]'
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <span
                          className={cn(
                            'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0',
                            isInactive
                              ? 'bg-amber-100 text-amber-700'
                              : isIn
                                ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)]'
                                : 'bg-black/[0.06] text-[#6E6E73]'
                          )}
                        >
                          {isIn ? <LogIn className="w-3 h-3" /> : <LogOut className="w-3 h-3" />}
                        </span>
                        <span className={cn('text-[13px] font-medium capitalize', isInactive ? 'text-amber-800' : 'text-[#1D1D1F]')}>
                          {p.direction}
                        </span>
                        {isInactive && (
                          <span className="text-[10.5px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-[1px] rounded-[4px]">Inactive</span>
                        )}
                      </span>
                      <span className="flex items-center gap-2.5">
                        <span className={cn('text-[13px] tabular-nums', isInactive ? 'text-amber-700' : 'text-[#6E6E73]')}>
                          {new Date(p.LOGDATE).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
                        </span>
                        {!locked && (
                          <>
                            <button
                              onClick={() => {
                                setEditingPunchSeq(p.device_attandance_seq);
                                setEditPunchTime(currentHHMMSS);
                                setEditPunchDirection(isIn ? 'in' : 'out');
                              }}
                              aria-label="Edit punch"
                              title="Edit time/direction"
                              className="w-6 h-6 rounded-full flex items-center justify-center text-[#86868B] hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                if (!isInactive && !confirm('Deactivate this punch? It will stop counting toward duration/OT but can be reactivated later.')) return;
                                togglePunchActiveMutation.mutate({ deviceAttandanceSeq: p.device_attandance_seq, active: isInactive });
                              }}
                              disabled={togglePunchActiveMutation.isPending}
                              aria-label={isInactive ? 'Reactivate punch' : 'Deactivate punch'}
                              title={isInactive ? 'Reactivate punch' : 'Deactivate punch'}
                              className={cn(
                                'w-6 h-6 rounded-full flex items-center justify-center disabled:opacity-40 transition-colors duration-150',
                                isInactive
                                  ? 'text-amber-600 hover:text-[color:var(--color-success-dark)] hover:bg-[color:var(--color-success-soft)]'
                                  : 'text-[#86868B] hover:text-amber-700 hover:bg-amber-100'
                              )}
                            >
                              <Power className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[13px] text-[#86868B] mb-4">No punches recorded for this date.</p>
            )}
            {/* Staged — entered here but not yet committed; goes out with the next Save, alongside
                Status/Overtime if those are also dirty. */}
            {stagedPunches.length > 0 && (
              <div className="space-y-1.5 mb-4">
                {stagedPunches.map((p, i) => {
                  const isIn = p.direction === 'in';
                  return (
                    <div key={i} className="flex items-center justify-between px-3.5 py-2.5 rounded-[10px] bg-[color:var(--color-primary)]/[0.06] border border-[color:var(--color-primary)]/15">
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
                        <span className="text-[10.5px] font-semibold text-[color:var(--color-primary)] bg-white px-1.5 py-[1px] rounded-[4px]">Pending</span>
                      </span>
                      <span className="flex items-center gap-2.5">
                        <span className="text-[13px] text-[#6E6E73] tabular-nums">{formatHHMMSS12(p.time)}</span>
                        <button
                          onClick={() => setStagedPunches((prev) => prev.filter((_, idx) => idx !== i))}
                          disabled={isSaving}
                          aria-label="Remove staged punch"
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[#86868B] hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 disabled:opacity-40 transition-colors duration-150"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {!locked && (
              <div className="flex items-center gap-2">
                <TimePicker value={punchTime} onChange={setPunchTime} disabled={isSaving} className="flex-1" />
                <select
                  value={punchDirection}
                  onChange={(e) => setPunchDirection(e.target.value as 'in' | 'out')}
                  disabled={isSaving}
                  className="h-11 px-3 rounded-[11px] border border-black/[0.08] bg-white text-[13px] text-[#1D1D1F] focus:outline-none focus:ring-[3px] focus:ring-[color:var(--color-primary)]/15 focus:border-[color:var(--color-primary)] disabled:opacity-50 transition-all duration-150"
                >
                  <option value="in">In</option>
                  <option value="out">Out</option>
                </select>
                <button
                  onClick={stagePunch}
                  disabled={isSaving}
                  className="h-11 px-4 rounded-[11px] border border-black/[0.08] bg-white text-[13px] font-medium text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] active:scale-[0.98] disabled:opacity-40 transition-all duration-150 whitespace-nowrap flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add to list
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
                    disabled={locked || isSaving}
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
                    disabled={locked || isSaving}
                    className="w-full h-11 px-3.5 rounded-[11px] border border-black/[0.08] bg-white text-[13px] text-[#1D1D1F] placeholder:text-[#86868B] focus:outline-none focus:ring-[3px] focus:ring-[color:var(--color-primary)]/15 focus:border-[color:var(--color-primary)] disabled:opacity-50 disabled:bg-[#F5F5F7] transition-all duration-150"
                  />
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Footer — one common Save commits only whatever's dirty across Status/Punches/Overtime */}
        <div className="border-t border-black/[0.06] flex-shrink-0">
          {hasChanges && (
            <p className="text-[12.5px] text-[#6E6E73] px-7 pt-4">
              Will save {[
                pendingStatus &&
                  `${pendingStatus.half === 'first' ? 'first half' : pendingStatus.half === 'second' ? 'second half' : 'full day'} as ${pendingStatus.status}`,
                stagedPunches.length > 0 && `${stagedPunches.length} punch${stagedPunches.length === 1 ? '' : 'es'}`,
                otDirty && `Overtime (${otValue === '' ? 'cleared' : `${otValue} min`})`,
              ].filter(Boolean).join(', ')}.
            </p>
          )}
          <div className="flex items-center justify-between gap-3 px-7 py-5">
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
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Bare codes — see the matching comment on HALVES' 'full' entry above; the day route's
// mergeHalfDayStatus does the "X/X" doubling itself for statusType: 'full'.
const BULK_STATUS_CODES = ['P', 'HO', 'WO', 'LOP'];

// Matches legacy's own Bulk Update "Status" dropdown (EditAttendanceController), which offers
// composite half-day codes directly rather than a bare code + separate half selector: Select,
// P/P, P/LOP, LOP/P, LOP/LOP.
const BULK_COMPOSITE_STATUS_CODES = ['P/P', 'P/LOP', 'LOP/P', 'LOP/LOP'];

// Matches legacy's "Option" dropdown next to Status: "All Dates" applies the chosen status to
// every non-NA day cell; "LOP Dates" narrows that to only cells that currently contain LOP
// (either half), leaving Present/Week Off/Holiday days untouched.
const BULK_OPTIONS = [
  { value: 'all', label: 'All Dates' },
  { value: 'lop', label: 'LOP Dates' },
] as const;

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
  const [option, setOption] = useState<'all' | 'lop'>('all');
  const [otValue, setOtValue] = useState('');
  const [otRemark, setOtRemark] = useState('');
  const [running, setRunning] = useState(false);

  const hasChanges = !!status || otValue !== '';
  const totalDays = rows.reduce((sum, r) => sum + r.days.length, 0);

  const handleApply = async () => {
    setRunning(true);
    let skippedNA = 0;
    let skippedOption = 0;
    const tasks: Promise<boolean>[] = [];

    for (const row of rows) {
      row.days.forEach((day, i) => {
        const value = (day.value ?? '').trim().toUpperCase();
        if (value === 'NA') {
          skippedNA++;
          return;
        }
        // "LOP Dates" narrows the Status write to cells that currently contain LOP in either
        // half, leaving Present/Week Off/Holiday days untouched — matches legacy's Option filter.
        if (status && option === 'lop' && !value.includes('LOP')) {
          skippedOption++;
          return;
        }
        const dayIndex = i + 1;
        if (status) {
          // Composite codes (e.g. "P/LOP") are written as two half-day PUTs so mergeHalfDayStatus
          // can compose them the same way the single-day editor does; bare codes (P/HO/WO/LOP)
          // still go through statusType: 'full' as before.
          if (status.includes('/')) {
            const [firstCode, secondCode] = status.split('/');
            tasks.push(
              fetch(`/api/attendance/register/${row.registerId}/day/${dayIndex}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ statusType: 'first', status: firstCode }),
              }).then((r) => r.ok).catch(() => false)
            );
            tasks.push(
              fetch(`/api/attendance/register/${row.registerId}/day/${dayIndex}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ statusType: 'second', status: secondCode }),
              }).then((r) => r.ok).catch(() => false)
            );
          } else {
            tasks.push(
              fetch(`/api/attendance/register/${row.registerId}/day/${dayIndex}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ statusType: 'full', status }),
              }).then((r) => r.ok).catch(() => false)
            );
          }
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
      `${skippedOption ? `, ${skippedOption} day(s) skipped (not LOP)` : ''}` +
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
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-[12px] font-medium text-[#6E6E73]">Status (applies to every non-NA day)</label>
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-medium text-[#6E6E73]">Option</span>
              <select
                value={option}
                onChange={(e) => setOption(e.target.value as 'all' | 'lop')}
                disabled={running}
                className="text-[12.5px] border border-black/10 rounded-[8px] px-2 py-1 disabled:opacity-40"
              >
                {BULK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mb-1">
            {BULK_COMPOSITE_STATUS_CODES.map((c) => {
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
