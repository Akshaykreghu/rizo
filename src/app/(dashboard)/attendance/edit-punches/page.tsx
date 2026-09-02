'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { RefreshCw, RotateCcw, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

interface PunchRow {
  device_attandance_seq: number;
  LOGDATE: string;
  direction: string;
  SHIFTDATE: string;
}

export default function EditPunchesPage() {
  const { slotEl } = useHeaderSlot();
  const [empFkey, setEmpFkey] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [message, setMessage] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ logDate: '', logTime: '', direction: 'in' as 'in' | 'out' });

  const { data, isLoading, refetch } = useQuery<{ data: PunchRow[] }>({
    queryKey: ['punches', empFkey, month],
    queryFn: () => fetch(`/api/attendance/punches?empFkey=${empFkey}&month=${month}`).then((r) => r.json()),
    enabled: !!empFkey,
  });

  const sync = useMutation({
    mutationFn: () => fetch('/api/attendance/punches/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empFkey: Number(empFkey), month }),
    }).then((r) => r.json()),
    onSuccess: (result) => { setMessage(result.message ?? 'Synced'); refetch(); },
  });

  const resync = useMutation({
    mutationFn: () => fetch('/api/attendance/punches/resync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empFkey: Number(empFkey), month }),
    }).then((r) => r.json()),
    onSuccess: (result) => { setMessage(result.message ?? 'Re-synced'); refetch(); },
  });

  const addPunch = useMutation({
    mutationFn: () => fetch('/api/attendance/punches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empFkey: Number(empFkey), ...addForm }),
    }).then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? 'Failed to add punch');
      return body;
    }),
    onSuccess: () => { setShowAdd(false); setAddForm({ logDate: '', logTime: '', direction: 'in' }); refetch(); },
    onError: (err: Error) => setMessage(err.message),
  });

  const editShiftDate = useMutation({
    mutationFn: (vars: { id: number; shiftDate: string }) =>
      fetch(`/api/attendance/punches/${vars.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftDate: vars.shiftDate }),
      }).then((r) => r.json()),
    onSuccess: () => refetch(),
  });

  const rows = data?.data ?? [];

  const columns: ColumnDef<PunchRow, unknown>[] = [
    { id: 'logDateTime', header: 'Log Date/Time', cell: ({ row }) => new Date(row.original.LOGDATE).toLocaleString() },
    { id: 'direction', header: 'Direction', cell: ({ row }) => <span className="capitalize">{row.original.direction}</span> },
    { id: 'shiftDate', header: 'Shift Date', cell: ({ row }) => row.original.SHIFTDATE?.slice(0, 10) },
    {
      id: 'moveTo',
      header: 'Move to Date',
      cell: ({ row }) => (
        <input
          type="date"
          defaultValue={row.original.SHIFTDATE?.slice(0, 10)}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            if (e.target.value && e.target.value !== row.original.SHIFTDATE?.slice(0, 10)) {
              editShiftDate.mutate({ id: row.original.device_attandance_seq, shiftDate: e.target.value });
            }
          }}
          className={INPUT_CLASS}
        />
      ),
    },
  ];

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Edit Punches
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Sync device punches and adjust their shift date
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
          <EmployeeSearch value={empFkey} onChange={setEmpFkey} />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={INPUT_CLASS} />
        </div>
        <button onClick={() => sync.mutate()} disabled={!empFkey || sync.isPending} className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}>
          <RefreshCw className="w-3.5 h-3.5" /> Sync
        </button>
        <button onClick={() => resync.mutate()} disabled={!empFkey || resync.isPending} className={cn(BTN_BASE, 'bg-slate-600 hover:bg-slate-700 text-white')}>
          <RotateCcw className="w-3.5 h-3.5" /> Re-sync
        </button>
        <button onClick={() => setShowAdd(true)} disabled={!empFkey} className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}>
          <Plus className="w-3.5 h-3.5" /> Add Punch
        </button>
      </div>

      {message && <div className="mb-4 text-[12.5px] bg-[color:var(--color-primary-light)] text-[color:var(--color-primary-dark)] px-3.5 py-2 rounded-lg">{message}</div>}

      {!empFkey && <p className="text-[12.5px] text-slate-400">Select an employee to view punches.</p>}
      {empFkey && !isLoading && rows.length === 0 && <p className="text-[12.5px] text-slate-400 mb-2">No punches for this month. Try Sync.</p>}
      {empFkey && (
        <DataTable data={rows} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setShowAdd(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-sm animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">Add Punch</h2>
              <button onClick={() => setShowAdd(false)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Date</label>
                <input type="date" value={addForm.logDate} onChange={(e) => setAddForm((f) => ({ ...f, logDate: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')} />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Time</label>
                <input type="time" step="1" value={addForm.logTime} onChange={(e) => setAddForm((f) => ({ ...f, logTime: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')} />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Direction</label>
                <select value={addForm.direction} onChange={(e) => setAddForm((f) => ({ ...f, direction: e.target.value as 'in' | 'out' }))} className={cn(INPUT_CLASS, 'w-full')}>
                  <option value="in">In</option>
                  <option value="out">Out</option>
                </select>
              </div>
            </div>
            <button
              onClick={() => addPunch.mutate()}
              disabled={!addForm.logDate || !addForm.logTime || addPunch.isPending}
              className={cn(BTN_BASE, 'w-full justify-center mt-4 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
            >
              {addPunch.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
