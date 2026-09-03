'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { Plus, Check, X, CheckCheck } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

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

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

interface RegRow {
  id: number;
  att_date: string;
  direction: 'in' | 'out';
  remarks: string | null;
  LOGTIME: string;
  approved: 'P' | 'A' | 'R';
  first_name: string;
  last_name: string;
  emp_id: string;
  branch_name: string | null;
}

export default function RegularisationPage() {
  const { slotEl } = useHeaderSlot();
  const [month, setMonth] = useState(currentMonth());
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('pending');
  const [showRaise, setShowRaise] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ empFkey: '', attDate: '', direction: 'in' as 'in' | 'out', logTime: '', remarks: '' });
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const { data: branches = [] } = useLookup('setup/branches', 'branch_code', (r) => String(r.branch_name));

  const { data, isLoading, refetch } = useQuery<{ data: RegRow[] }>({
    queryKey: ['regularisation', month, branch, status],
    queryFn: () => fetch(`/api/attendance/regularisation?month=${month}&branch=${branch}&status=${status}`).then((r) => r.json()),
  });

  const rows = data?.data ?? [];

  const raise = useMutation({
    mutationFn: () =>
      fetch('/api/attendance/regularisation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, empFkey: Number(form.empFkey) }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to raise request');
        return body;
      }),
    onSuccess: () => {
      setMessage('Regularisation request raised');
      setShowRaise(false);
      setForm({ empFkey: '', attDate: '', direction: 'in', logTime: '', remarks: '' });
      refetch();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const decide = useMutation({
    mutationFn: (vars: { id: number; decision: 'approve' | 'reject' }) =>
      fetch(`/api/attendance/regularisation/${vars.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: vars.decision }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to update request');
        return body;
      }),
    onSuccess: () => { refetch(); },
    onError: (err: Error) => setMessage(err.message),
  });

  const bulkDecide = useMutation({
    mutationFn: (vars: { decision: 'approve' | 'reject' }) =>
      fetch('/api/attendance/regularisation/bulk-decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(checked), decision: vars.decision }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to update requests');
        return body as { succeeded: number[]; failed: { id: number; reason: string }[] };
      }),
    onSuccess: (body) => {
      setChecked(new Set());
      setMessage(
        body.failed.length
          ? `${body.succeeded.length} updated, ${body.failed.length} failed (${body.failed[0].reason})`
          : `${body.succeeded.length} request(s) updated`
      );
      refetch();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const pendingRows = rows.filter((r) => r.approved === 'P');
  const allPendingChecked = pendingRows.length > 0 && pendingRows.every((r) => checked.has(r.id));

  const columns: ColumnDef<RegRow, unknown>[] = [
    ...(status === 'pending'
      ? [{
          id: 'select',
          header: () => (
            <input
              type="checkbox"
              checked={allPendingChecked}
              onChange={(e) => setChecked(e.target.checked ? new Set(pendingRows.map((r) => r.id)) : new Set())}
            />
          ),
          meta: { className: 'w-8' },
          cell: ({ row }: { row: { original: RegRow } }) => (
            <input
              type="checkbox"
              checked={checked.has(row.original.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setChecked((prev) => {
                const next = new Set(prev);
                if (e.target.checked) next.add(row.original.id); else next.delete(row.original.id);
                return next;
              })}
            />
          ),
        } as ColumnDef<RegRow, unknown>]
      : []),
    { id: 'employee', header: 'Employee', cell: ({ row }) => <>{row.original.first_name} {row.original.last_name} <span className="text-slate-400 text-[11px]">({row.original.emp_id})</span></> },
    { accessorKey: 'branch_name', header: 'Branch' },
    { accessorKey: 'att_date', header: 'Date' },
    { id: 'direction', header: 'Direction', cell: ({ row }) => <span className="capitalize">{row.original.direction}</span> },
    { accessorKey: 'LOGTIME', header: 'Time' },
    { id: 'remarks', header: 'Remarks', cell: ({ row }) => <span className="text-slate-500">{row.original.remarks}</span> },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <span
          className={cn(
            'px-2 py-0.5 rounded text-[11px] font-medium',
            row.original.approved === 'A'
              ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)]'
              : row.original.approved === 'R'
                ? 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-dark)]'
                : 'bg-[color:var(--color-highlight-light)] text-[color:var(--color-highlight-dark)]'
          )}
        >
          {row.original.approved === 'A' ? 'Approved' : row.original.approved === 'R' ? 'Rejected' : 'Pending'}
        </span>
      ),
    },
    ...(status === 'pending'
      ? [{
          id: 'actions',
          header: '',
          meta: { className: 'w-16' },
          cell: ({ row }: { row: { original: RegRow } }) => (
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); decide.mutate({ id: row.original.id, decision: 'approve' }); }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-success-dark)] hover:bg-[color:var(--color-success-soft)] transition-colors duration-150"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); decide.mutate({ id: row.original.id, decision: 'reject' }); }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ),
        } as ColumnDef<RegRow, unknown>]
      : []),
  ];

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Regularisation
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Raise and approve attendance regularisation requests
            </p>
          </div>,
          slotEl
        )}

      <div className="flex items-center justify-end gap-2 mb-4">
        {checked.size > 0 && (
          <>
            <button
              onClick={() => bulkDecide.mutate({ decision: 'approve' })}
              disabled={bulkDecide.isPending}
              className={cn(BTN_BASE, 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)] hover:bg-[color:var(--color-success)]/20')}
            >
              <CheckCheck className="w-3.5 h-3.5" /> Approve ({checked.size})
            </button>
            <button
              onClick={() => bulkDecide.mutate({ decision: 'reject' })}
              disabled={bulkDecide.isPending}
              className={cn(BTN_BASE, 'bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger-dark)] hover:bg-[color:var(--color-danger)]/20')}
            >
              <X className="w-3.5 h-3.5" /> Reject ({checked.size})
            </button>
          </>
        )}
        <button
          onClick={() => setShowRaise(true)}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" /> Raise Regularisation
        </button>
      </div>

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setChecked(new Set()); }} className={INPUT_CLASS} />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
          <select value={branch} onChange={(e) => { setBranch(e.target.value); setChecked(new Set()); }} className={cn(INPUT_CLASS, 'min-w-[160px]')}>
            <option value="">All branches</option>
            {branches.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Status</label>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setChecked(new Set()); }} className={INPUT_CLASS}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="">All</option>
          </select>
        </div>
        {message && <span className="text-[12.5px] text-slate-500">{message}</span>}
      </div>

      <DataTable data={rows} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />

      {showRaise && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setShowRaise(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">Raise Regularisation</h2>
              <button onClick={() => setShowRaise(false)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Employee</label>
                <EmployeeSearch value={form.empFkey} onChange={(v) => setForm((f) => ({ ...f, empFkey: v }))} />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Date</label>
                <input type="date" value={form.attDate} onChange={(e) => setForm((f) => ({ ...f, attDate: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')} />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Direction</label>
                <select value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value as 'in' | 'out' }))} className={cn(INPUT_CLASS, 'w-full')}>
                  <option value="in">In</option>
                  <option value="out">Out</option>
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Time</label>
                <input type="time" step="1" value={form.logTime} onChange={(e) => setForm((f) => ({ ...f, logTime: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')} />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Remarks</label>
                <input type="text" value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')} />
              </div>
            </div>
            <button
              onClick={() => raise.mutate()}
              disabled={!form.empFkey || !form.attDate || !form.logTime || raise.isPending}
              className={cn(BTN_BASE, 'w-full justify-center mt-4 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
            >
              {raise.isPending ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
