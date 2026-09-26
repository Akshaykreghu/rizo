'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Check, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { cn, formatCurrency } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

interface AdvanceRow {
  emp_advance_pkey: number;
  emp_fkey: number;
  emp_name: string;
  advance_amount: number;
  affected_month: string;
  is_credited: string;
  remarks: string | null;
  payment_date: string | null;
}

interface AdvanceRequestRow {
  emp_advance_request_pkey: number;
  emp_fkey: number;
  emp_name: string;
  advance_amount: number;
  affected_month: string;
  remarks: string | null;
  request_status: 'Pending' | 'Approved' | 'Rejected' | 'Deleted';
  admin_remarks: string | null;
  created_date: string;
}

const STATUS_BADGE: Record<string, string> = {
  Pending: 'bg-amber-50 text-amber-700',
  Approved: 'bg-emerald-50 text-emerald-700',
  Rejected: 'bg-rose-50 text-rose-700',
  Deleted: 'bg-slate-100 text-slate-500',
};

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const TAB_BTN_BASE = 'px-3.5 py-1.5 rounded-[9px] text-[12.5px] font-semibold transition-colors';

export default function AdvancesPage() {
  const { slotEl } = useHeaderSlot();
  const [tab, setTab] = useState<'advances' | 'requests'>('advances');

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Salary Advances
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Record and track employee salary advances, by month
            </p>
          </div>,
          slotEl
        )}

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setTab('advances')}
          className={cn(TAB_BTN_BASE, tab === 'advances' ? 'bg-[color:var(--color-primary)] text-white' : 'bg-white border border-slate-200 text-slate-500 hover:text-[#0F172A]')}
        >
          Advances
        </button>
        <button
          onClick={() => setTab('requests')}
          className={cn(TAB_BTN_BASE, tab === 'requests' ? 'bg-[color:var(--color-primary)] text-white' : 'bg-white border border-slate-200 text-slate-500 hover:text-[#0F172A]')}
        >
          Requests
        </button>
      </div>

      {tab === 'advances' ? <AdvancesTab /> : <RequestsTab />}
    </div>
  );
}

function AdvancesTab() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonthYear());
  const [showForm, setShowForm] = useState(false);
  const [empId, setEmpId] = useState('');
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [affectedMonth, setAffectedMonth] = useState('');
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const { data: limitData } = useQuery<{ limit: number }>({
    queryKey: ['advances/limit', empId],
    queryFn: () => fetch(`/api/advances/limit?empFkey=${empId}`).then((r) => r.json()),
    enabled: !!empId,
  });

  const { data, isLoading } = useQuery<{ rows: AdvanceRow[] }>({
    queryKey: ['advances', month],
    queryFn: () => fetch(`/api/advances?month=${month}`).then((r) => r.json()),
  });
  const rows = data?.rows ?? [];

  useEffect(() => { if (!affectedMonth) setAffectedMonth(month); }, [month, affectedMonth]);

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/advances', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empFkey: Number(empId), advanceAmount: Number(advanceAmount), affectedMonth, remarks: remarks || undefined,
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Failed to create advance');
      return b as { id: number; warning?: string };
    },
    onSuccess: (b) => {
      setMessage(b.warning ?? 'Advance saved.');
      setShowForm(false);
      setEmpId(''); setAdvanceAmount(''); setAffectedMonth(''); setRemarks('');
      queryClient.invalidateQueries({ queryKey: ['advances'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => fetch(`/api/advances/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setMessage('Advance removed.');
      queryClient.invalidateQueries({ queryKey: ['advances'] });
    },
  });

  const columns: ColumnDef<AdvanceRow, unknown>[] = [
    { accessorKey: 'emp_name', header: 'Employee', cell: ({ getValue }) => <span className="font-medium text-[#0F172A]">{String(getValue())}</span> },
    { id: 'amount', header: 'Amount', cell: ({ row }) => formatCurrency(row.original.advance_amount) },
    { accessorKey: 'affected_month', header: 'Affected Month' },
    { id: 'remarks', header: 'Remarks', cell: ({ row }) => row.original.remarks || '-' },
    {
      id: 'actions',
      header: '',
      meta: { className: 'w-14' },
      cell: ({ row }) => (
        <button
          onClick={(e) => { e.stopPropagation(); remove.mutate(row.original.emp_advance_pkey); }}
          title="Remove"
          className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        <button
          onClick={() => setShowForm((v) => !v)}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" />
          New Advance
        </button>
      </div>

      {message && <p className="text-[12.5px] text-slate-500 mb-4">{message}</p>}

      {showForm && (
        <div className="surface-card rounded-xl p-4 mb-4 space-y-3">
          <div className="max-w-sm">
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
            <EmployeeSearch value={empId} onChange={setEmpId} placeholder="Search employee by name or ID" />
            {empId && limitData && (
              <p className="text-[11.5px] text-slate-400 mt-1">Suggested limit (80% of monthly gross): {formatCurrency(limitData.limit)}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Advance Amount (₹)</label>
              <input type="number" value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} className={cn(INPUT_CLASS, 'w-full')} />
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Affected Month</label>
              <input type="month" value={affectedMonth} onChange={(e) => setAffectedMonth(e.target.value)} className={cn(INPUT_CLASS, 'w-full')} />
            </div>
            <div className="col-span-2">
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Remarks</label>
              <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={cn(INPUT_CLASS, 'w-full')} />
            </div>
          </div>
          <button
            onClick={() => create.mutate()}
            disabled={!empId || !advanceAmount || !affectedMonth || create.isPending}
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
          >
            {create.isPending ? 'Saving…' : 'Save Advance'}
          </button>
        </div>
      )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 max-w-xs">
        <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={cn(INPUT_CLASS, 'w-full')} />
      </div>

      <DataTable data={rows} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />
    </div>
  );
}

// Requests submitted by employees via ESS "My Request" → Salary Advance. Approving inserts a real
// emp_advance row (identical to the Advances tab's own "New Advance" flow) — see
// approveAdvanceRequest() in lib/advances.ts. Rejecting leaves emp_advance untouched.
function RequestsTab() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'Pending' | 'Approved' | 'Rejected' | 'Deleted' | ''>('Pending');
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ rows: AdvanceRequestRow[] }>({
    queryKey: ['advances/requests', status],
    queryFn: () => fetch(`/api/advances/requests${status ? `?status=${status}` : ''}`).then((r) => r.json()),
  });
  const rows = data?.rows ?? [];

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['advances/requests'] });
    queryClient.invalidateQueries({ queryKey: ['advances'] });
  };

  const approve = useMutation({
    mutationFn: (id: number) => fetch(`/api/advances/requests/${id}/approve`, { method: 'POST' })
      .then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error ?? 'Failed to approve'); return b; }),
    onSuccess: () => { setMessage('Request approved and advance created.'); invalidateAll(); },
    onError: (err: Error) => setMessage(err.message),
  });

  const reject = useMutation({
    mutationFn: (id: number) => {
      const adminRemarks = window.prompt('Reason for rejection (optional):') ?? undefined;
      return fetch(`/api/advances/requests/${id}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminRemarks }),
      }).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error ?? 'Failed to reject'); return b; });
    },
    onSuccess: () => { setMessage('Request rejected.'); invalidateAll(); },
    onError: (err: Error) => setMessage(err.message),
  });

  const columns: ColumnDef<AdvanceRequestRow, unknown>[] = [
    { accessorKey: 'emp_name', header: 'Employee', cell: ({ getValue }) => <span className="font-medium text-[#0F172A]">{String(getValue())}</span> },
    { id: 'amount', header: 'Amount', cell: ({ row }) => formatCurrency(row.original.advance_amount) },
    { accessorKey: 'affected_month', header: 'Affected Month' },
    { id: 'remarks', header: 'Remarks', cell: ({ row }) => row.original.remarks || '-' },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <span className={cn('inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold', STATUS_BADGE[row.original.request_status])}>
          {row.original.request_status}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      meta: { className: 'w-24' },
      cell: ({ row }) =>
        row.original.request_status === 'Pending' ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); approve.mutate(row.original.emp_advance_request_pkey); }}
              title="Approve"
              className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors duration-150"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); reject.mutate(row.original.emp_advance_request_pkey); }}
              title="Reject"
              className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      {message && <p className="text-[12.5px] text-slate-500 mb-4">{message}</p>}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 max-w-xs">
        <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={cn(INPUT_CLASS, 'w-full')}>
          <option value="Pending">Pending</option>
          <option value="Approved">Approved</option>
          <option value="Rejected">Rejected</option>
          <option value="Deleted">Deleted</option>
          <option value="">All</option>
        </select>
      </div>

      <DataTable data={rows} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />
    </div>
  );
}
