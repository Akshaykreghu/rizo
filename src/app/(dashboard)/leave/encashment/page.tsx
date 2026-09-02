'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { Plus, Check, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

interface BalanceRow {
  salaryHeadItemFkey: number;
  name: string;
  isLeaveEncash: boolean;
  balance: number;
}

interface EncashRow {
  leave_encashment_master_pkey: number;
  emp_name: string;
  leave_type: string;
  encash_days: number;
  available_days: number;
  requested_days: number;
  approved_days: number | null;
  is_approved: 'Y' | 'N';
  approved_date: string | null;
}

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function LeaveEncashmentPage() {
  const { slotEl } = useHeaderSlot();
  const [status, setStatus] = useState('pending');
  const [showApply, setShowApply] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [empFkey, setEmpFkey] = useState('');
  const [reason, setReason] = useState('');
  const [requested, setRequested] = useState<Record<number, string>>({});

  const { data: balancesData } = useQuery<{ data: BalanceRow[] }>({
    queryKey: ['leave', 'balances', empFkey],
    queryFn: () => fetch(`/api/leave/balances?employee=${empFkey}`).then((r) => r.json()),
    enabled: !!empFkey,
  });
  const encashableTypes = (balancesData?.data ?? []).filter((t) => t.isLeaveEncash);

  const { data, isLoading, refetch } = useQuery<{ data: EncashRow[] }>({
    queryKey: ['leave', 'encashment', status],
    queryFn: () => fetch(`/api/leave/encashment?status=${status}`).then((r) => r.json()),
  });
  const rows = data?.data ?? [];

  const apply = useMutation({
    mutationFn: () =>
      fetch('/api/leave/encashment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empFkey: Number(empFkey),
          reason,
          items: encashableTypes.map((t) => ({
            salaryHeadItemFkey: t.salaryHeadItemFkey,
            encashDays: t.balance,
            availableDays: t.balance,
            requestedDays: Number(requested[t.salaryHeadItemFkey] ?? 0),
          })),
        }),
      }).then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? 'Failed to submit');
        return b;
      }),
    onSuccess: (b) => {
      setMessage(`Encashment request(s) submitted (${b.ids.length})`);
      setShowApply(false);
      setEmpFkey('');
      setRequested({});
      setReason('');
      refetch();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const approve = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/leave/encashment/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? 'Approve failed');
        return b;
      }),
    onSuccess: (b) => { setMessage(b.procMessage ?? 'Approved'); refetch(); },
    onError: (err: Error) => setMessage(err.message),
  });

  const columns: ColumnDef<EncashRow, unknown>[] = [
    { accessorKey: 'emp_name', header: 'Employee', cell: ({ getValue }) => <span className="font-medium text-[#0F172A]">{String(getValue())}</span> },
    { accessorKey: 'leave_type', header: 'Leave Type' },
    { accessorKey: 'requested_days', header: 'Requested Days' },
    { id: 'approvedDays', header: 'Approved Days', cell: ({ row }) => row.original.approved_days ?? '—' },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <span
          className={cn(
            'px-2 py-0.5 rounded text-[11px] font-medium',
            row.original.is_approved === 'Y'
              ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)]'
              : 'bg-[color:var(--color-highlight-light)] text-[color:var(--color-highlight-dark)]'
          )}
        >
          {row.original.is_approved === 'Y' ? 'Approved' : 'Pending'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      meta: { className: 'w-14' },
      cell: ({ row }) => (
        row.original.is_approved === 'N' ? (
          <button
            onClick={(e) => { e.stopPropagation(); approve.mutate(row.original.leave_encashment_master_pkey); }}
            title="Approve"
            className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-success-dark)] hover:bg-[color:var(--color-success-soft)] transition-colors duration-150"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
        ) : null
      ),
    },
  ];

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Leave Encashment
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Request and approve leave encashment
            </p>
          </div>,
          slotEl
        )}

      <div className="flex items-center justify-end mb-4">
        <button
          onClick={() => setShowApply(true)}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" /> New Request
        </button>
      </div>

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={INPUT_CLASS}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="">All</option>
          </select>
        </div>
        {message && <span className="text-[12.5px] text-slate-500">{message}</span>}
      </div>

      <DataTable data={rows} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />

      {showApply && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setShowApply(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">New Encashment Request</h2>
              <button onClick={() => setShowApply(false)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Employee</label>
                <EmployeeSearch value={empFkey} onChange={setEmpFkey} />
              </div>
              {encashableTypes.length === 0 && empFkey && (
                <p className="text-[12px] text-slate-400">No encashable leave types configured for this employee&apos;s policy.</p>
              )}
              {encashableTypes.map((t) => (
                <div key={t.salaryHeadItemFkey} className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-[#0F172A]">{t.name} <span className="text-slate-400 text-[11px]">(balance: {t.balance})</span></span>
                  <input
                    type="number"
                    min={0}
                    max={t.balance}
                    step={0.5}
                    value={requested[t.salaryHeadItemFkey] ?? ''}
                    onChange={(e) => setRequested((r) => ({ ...r, [t.salaryHeadItemFkey]: e.target.value }))}
                    className={cn(INPUT_CLASS, 'w-24')}
                  />
                </div>
              ))}
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Reason</label>
                <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} className={cn(INPUT_CLASS, 'w-full')} />
              </div>
            </div>
            <button
              onClick={() => apply.mutate()}
              disabled={!empFkey || encashableTypes.every((t) => !Number(requested[t.salaryHeadItemFkey])) || apply.isPending}
              className={cn(BTN_BASE, 'w-full justify-center mt-4 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
            >
              {apply.isPending ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
