'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AttendanceGrid, type AttendanceDay, type AttendanceRow } from '@/components/attendance/AttendanceGrid';
import { ATTENDANCE_LEGEND } from '@/lib/attendance';
import { Play, ShieldCheck, ShieldOff, HelpCircle } from 'lucide-react';

interface Option { value: string; label: string }

function useLookup(path: string, valueKey: string, labelFn: (r: Record<string, unknown>) => string) {
  return useQuery<Option[]>({
    queryKey: [path],
    queryFn: () => fetch(`/api/${path}`).then((r) => r.json()).then((rows: Record<string, unknown>[]) =>
      rows.map((r) => ({ value: String(r[valueKey]), label: labelFn(r) }))
    ),
  });
}

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

export default function AttendanceRegisterPage() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [branch, setBranch] = useState('');
  const [tab, setTab] = useState<'unverified' | 'verified'>('unverified');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const [editCell, setEditCell] = useState<{ row: AttendanceRow; dayIndex: number; day: AttendanceDay } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { data: branches = [] } = useLookup('setup/branches', 'branch_code', (r) => String(r.branch_name));

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['attendance-register', month, branch, tab],
    queryFn: () =>
      fetch(`/api/attendance/register?month=${month}&branch=${branch}&status=${tab}`).then((r) => r.json()),
    enabled: !!branch,
  });

  const rows: AttendanceRow[] = data?.data ?? [];

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

  const { data: leaveOptionsData } = useQuery<{ options: LeaveOption[] }>({
    queryKey: ['attendance-leave-options', editCell?.row.registerId],
    queryFn: () => fetch(`/api/attendance/register/${editCell!.row.registerId}/leave-options`).then((r) => r.json()),
    enabled: !!editCell,
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
    onSuccess: () => {
      setEditCell(null);
      refetch();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const toggleSelect = (registerId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(registerId)) next.delete(registerId);
      else next.add(registerId);
      return next;
    });
  };

  const leaveOptions = useMemo(() => leaveOptionsData?.options ?? [], [leaveOptionsData]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Attendance Register</h1>
        <button onClick={() => setShowLegend((v) => !v)} className="text-gray-400 hover:text-gray-600">
          <HelpCircle className="w-5 h-5" />
        </button>
      </div>

      {showLegend && (
        <div className="mb-4 flex gap-4 text-xs border border-gray-200 rounded-lg p-3 bg-white">
          {ATTENDANCE_LEGEND.map((l) => (
            <div key={l.code} className="flex items-center gap-1">
              <span className="w-4 h-4 rounded" style={{ backgroundColor: l.bg }} />
              {l.code} = {l.label}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Branch</label>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm min-w-[180px]">
            <option value="">Select branch</option>
            {branches.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <button
          onClick={() => process.mutate()}
          disabled={!branch || process.isPending}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
        >
          <Play className="w-4 h-4" /> Process
        </button>
        {tab === 'unverified' ? (
          <button
            onClick={() => verify.mutate()}
            disabled={selected.size === 0 || verify.isPending}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
          >
            <ShieldCheck className="w-4 h-4" /> Verify
          </button>
        ) : (
          <button
            onClick={() => unverify.mutate()}
            disabled={selected.size === 0 || unverify.isPending}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
          >
            <ShieldOff className="w-4 h-4" /> Un-verify
          </button>
        )}
      </div>

      {message && <div className="mb-4 text-sm bg-blue-50 text-blue-700 px-3 py-2 rounded-lg">{message}</div>}

      <div className="flex gap-4 mb-4 border-b border-gray-200">
        <button
          onClick={() => { setTab('unverified'); setSelected(new Set()); }}
          className={`pb-2 text-sm font-medium ${tab === 'unverified' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500'}`}
        >
          Not Verified
        </button>
        <button
          onClick={() => { setTab('verified'); setSelected(new Set()); }}
          className={`pb-2 text-sm font-medium ${tab === 'verified' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500'}`}
        >
          Verified
        </button>
      </div>

      {!branch && <p className="text-sm text-gray-400">Select a branch to view attendance.</p>}
      {branch && isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {branch && !isLoading && rows.length === 0 && <p className="text-sm text-gray-400">No records for this month/branch. Try Process first.</p>}
      {branch && rows.length > 0 && (
        <AttendanceGrid
          rows={rows}
          selected={selected}
          onToggleSelect={toggleSelect}
          onCellClick={tab === 'unverified' ? (row, dayIndex, day) => setEditCell({ row, dayIndex, day }) : undefined}
          expandedRow={expandedRow}
          onToggleExpand={(id) => setExpandedRow((prev) => (prev === id ? null : id))}
          readOnly={tab === 'verified'}
        />
      )}

      {editCell && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditCell(null)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold mb-1">{editCell.row.empName} — {editCell.day.date}</h2>
            <p className="text-xs text-gray-400 mb-4">Current: {editCell.day.value || '—'}</p>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <EditColumn
                title="First Half"
                codes={['P', 'LOP']}
                leaveOptions={leaveOptions}
                onPick={(status, salaryHeadItemFkey) => editCellMutation.mutate({ statusType: 'first', status, salaryHeadItemFkey })}
              />
              <EditColumn
                title="Second Half"
                codes={['P', 'LOP', 'WO']}
                leaveOptions={leaveOptions}
                onPick={(status, salaryHeadItemFkey) => editCellMutation.mutate({ statusType: 'second', status, salaryHeadItemFkey })}
              />
              <EditColumn
                title="Full Day"
                codes={['P/P', 'HO', 'WO', 'LOP/LOP']}
                leaveOptions={leaveOptions}
                onPick={(status, salaryHeadItemFkey) => editCellMutation.mutate({ statusType: 'full', status, salaryHeadItemFkey })}
              />
            </div>
            {editCellMutation.isPending && <p className="text-xs text-gray-400 mt-3">Saving…</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function EditColumn({
  title, codes, leaveOptions, onPick,
}: {
  title: string;
  codes: string[];
  leaveOptions: LeaveOption[];
  onPick: (status: string, salaryHeadItemFkey?: number) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 mb-2">{title}</p>
      <div className="flex flex-col gap-1.5">
        {codes.map((c) => (
          <button key={c} onClick={() => onPick(c)} className="border border-gray-200 rounded-lg px-2 py-1 text-left hover:bg-gray-50">
            {c}
          </button>
        ))}
        {leaveOptions.map((lo) => (
          <button
            key={lo.salary_head_item_fkey}
            onClick={() => onPick(lo.code, lo.salary_head_item_fkey)}
            disabled={!lo.isIndirect && lo.balance <= 0}
            className="border border-gray-200 rounded-lg px-2 py-1 text-left hover:bg-gray-50 disabled:opacity-40"
          >
            {lo.code} ({lo.balance})
          </button>
        ))}
      </div>
    </div>
  );
}
