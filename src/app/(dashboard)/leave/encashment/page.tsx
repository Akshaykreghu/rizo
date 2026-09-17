'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { useSetupOptions } from '@/lib/setupOptions';
import { Plus, Check, X, RefreshCw, Ban } from 'lucide-react';
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
  emp_fkey: number;
  emp_name: string;
  leave_type: string;
  encash_days: number;
  available_days: number;
  requested_days: number;
  approved_days: number | null;
  is_approved: 'Y' | 'N';
  approved_date: string | null;
  emp_company_id: string | null;
  action: string | null;
  leaveLimit: number | null;
  alreadyEncashed: number;
  canEncash: boolean;
}

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const TABS = [
  { key: 'pending', label: 'To be Encashed' },
  { key: 'approved', label: 'Encashed' },
] as const;

const PAYROLL_LOCKED = ['Processed', 'Approved'];

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function LeaveEncashmentPage() {
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('pending');
  const [branch, setBranch] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [filterEmp, setFilterEmp] = useState('');
  const [filterItem, setFilterItem] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  const [message, setMessage] = useState<string | null>(null);

  const [showApply, setShowApply] = useState(false);
  const [empFkey, setEmpFkey] = useState('');
  const [reason, setReason] = useState('');
  const [requested, setRequested] = useState<Record<number, string>>({});

  const { data: branches = [] } = useSetupOptions('setup/branches', 'branch_code', (r) => String(r.branch_name));
  const { data: itemOptions = [] } = useSetupOptions('setup/leave-types', 'salary_head_item_pkey', (r) => String(r.item));

  const { data: balancesData } = useQuery<{ data: BalanceRow[] }>({
    queryKey: ['leave', 'balances', empFkey],
    queryFn: () => fetch(`/api/leave/balances?employee=${empFkey}`).then((r) => r.json()),
    enabled: !!empFkey,
  });
  const encashableTypes = (balancesData?.data ?? []).filter((t) => t.isLeaveEncash);

  const queryKey = ['leave', 'encashment', tab, branch, month, filterEmp, filterItem];
  const { data, isLoading } = useQuery<{ data: EncashRow[] }>({
    queryKey,
    queryFn: () =>
      fetch(
        `/api/leave/encashment?tab=${tab}&branch=${branch}&month=${month}&employee=${filterEmp}&item=${filterItem}`
      ).then((r) => r.json()),
  });
  const rows = data?.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['leave', 'encashment'] });

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
      invalidate();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const generate = useMutation({
    mutationFn: () =>
      fetch('/api/leave/encashment/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchCode: branch || undefined, employee: filterEmp || undefined, itemFkey: filterItem || undefined, month }),
      }).then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? 'Generate failed');
        return b;
      }),
    onSuccess: (b) => { setMessage(b.procMessage || 'Generated'); invalidate(); },
    onError: (err: Error) => setMessage(err.message),
  });

  const approveOne = useMutation({
    mutationFn: ({ id, approvedDays }: { id: number; approvedDays: number }) =>
      fetch(`/api/leave/encashment/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedDays }),
      }).then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? 'Approve failed');
        return b;
      }),
    onSuccess: (b) => { setMessage(b.procMessage ?? 'Encashed'); invalidate(); },
    onError: (err: Error) => setMessage(err.message),
  });

  const cancelOne = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/leave/encashment/${id}/cancel`, { method: 'POST' }).then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? 'Cancel failed');
        return b;
      }),
    onSuccess: () => { setMessage('Request cancelled'); invalidate(); },
    onError: (err: Error) => setMessage(err.message),
  });

  const bulkApprove = useMutation({
    mutationFn: () =>
      fetch('/api/leave/encashment/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selected),
          approvedDaysById: Object.fromEntries(Array.from(selected).map((id) => [id, overrides[id] ?? rows.find((r) => r.leave_encashment_master_pkey === id)?.requested_days ?? 0])),
        }),
      }).then((r) => r.json()),
    onSuccess: (b) => {
      setMessage(`Encashed ${b.succeeded.length} of ${selected.size}`);
      setSelected(new Set());
      invalidate();
    },
  });

  const bulkCancel = useMutation({
    mutationFn: () =>
      fetch('/api/leave/encashment/bulk-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      }).then((r) => r.json()),
    onSuccess: () => {
      setMessage(`Cancelled ${selected.size} request(s)`);
      setSelected(new Set());
      invalidate();
    },
  });

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.leave_encashment_master_pkey))));
  };

  const columns: ColumnDef<EncashRow, unknown>[] = [
    ...(tab === 'pending'
      ? [{
          id: 'select',
          header: () => (
            <input
              type="checkbox"
              checked={rows.length > 0 && selected.size === rows.length}
              onChange={toggleAll}
              className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40"
            />
          ),
          meta: { className: 'w-10' },
          cell: ({ row }: { row: { original: EncashRow } }) => (
            <input
              type="checkbox"
              checked={selected.has(row.original.leave_encashment_master_pkey)}
              onChange={(e) => { e.stopPropagation(); toggle(row.original.leave_encashment_master_pkey); }}
              onClick={(e) => e.stopPropagation()}
              className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40"
            />
          ),
        } as ColumnDef<EncashRow, unknown>]
      : []),
    { accessorKey: 'emp_name', header: 'Employee', cell: ({ getValue }) => <span className="font-medium text-[#0F172A]">{String(getValue())}</span> },
    { accessorKey: 'leave_type', header: 'Leave Type' },
    tab === 'pending'
      ? { accessorKey: 'available_days', header: 'Eligible' }
      : { id: 'approvedDate', header: 'Approved Date', cell: ({ row }) => row.original.approved_date ?? '—' },
    ...(tab === 'pending'
      ? [{
          id: 'encashingNow',
          header: 'Encashing Now',
          cell: ({ row }: { row: { original: EncashRow } }) => {
            const r = row.original;
            const locked = !!r.action && PAYROLL_LOCKED.includes(r.action);
            const cap = r.leaveLimit != null ? Math.max(0, r.leaveLimit - r.alreadyEncashed) : r.available_days;
            const max = Math.min(cap, r.available_days);
            const value = overrides[r.leave_encashment_master_pkey] ?? r.requested_days;
            return (
              <input
                type="number"
                min={0}
                max={max}
                step={0.5}
                disabled={locked || max <= 0}
                value={value}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = Math.min(max, Math.max(0, Number(e.target.value) || 0));
                  setOverrides((prev) => ({ ...prev, [r.leave_encashment_master_pkey]: v }));
                }}
                className={cn(INPUT_CLASS, 'w-20')}
              />
            );
          },
        } as ColumnDef<EncashRow, unknown>]
      : [{ accessorKey: 'approved_days', header: 'Approved Days' } as ColumnDef<EncashRow, unknown>]),
    { id: 'payroll', header: 'Payroll', cell: ({ row }) => row.original.action ?? '—' },
    {
      id: 'actions',
      header: '',
      meta: { className: 'w-20' },
      cell: ({ row }) => {
        if (tab !== 'pending') return null;
        const r = row.original;
        const locked = !!r.action && PAYROLL_LOCKED.includes(r.action);
        return (
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                const approvedDays = overrides[r.leave_encashment_master_pkey] ?? r.requested_days;
                approveOne.mutate({ id: r.leave_encashment_master_pkey, approvedDays });
              }}
              disabled={locked}
              title="Encash"
              className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-success-dark)] hover:bg-[color:var(--color-success-soft)] transition-colors duration-150 disabled:opacity-40"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); cancelOne.mutate(r.leave_encashment_master_pkey); }}
              title="Cancel"
              className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger-dark)] hover:bg-[color:var(--color-danger-soft)] transition-colors duration-150"
            >
              <Ban className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      },
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
              Generate, review and approve leave encashment
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
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={INPUT_CLASS} />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className={cn(INPUT_CLASS, 'min-w-[160px]')}>
            <option value="">All branches</option>
            {branches.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Leave Type</label>
          <select value={filterItem} onChange={(e) => setFilterItem(e.target.value)} className={cn(INPUT_CLASS, 'min-w-[160px]')}>
            <option value="">All types</option>
            {itemOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="min-w-[220px]">
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
          <EmployeeSearch value={filterEmp} onChange={setFilterEmp} placeholder="All employees" />
        </div>
        {tab === 'pending' && (
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className={cn(BTN_BASE, 'bg-white border border-slate-200 text-[#0F172A] hover:bg-slate-50')}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Generate
          </button>
        )}
        {tab === 'pending' && selected.size > 0 && (
          <>
            <button
              onClick={() => bulkApprove.mutate()}
              disabled={bulkApprove.isPending}
              className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
            >
              <Check className="w-3.5 h-3.5" /> Encash Selected ({selected.size})
            </button>
            <button
              onClick={() => bulkCancel.mutate()}
              disabled={bulkCancel.isPending}
              className={cn(BTN_BASE, 'bg-white border border-slate-200 text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger-soft)]')}
            >
              <Ban className="w-3.5 h-3.5" /> Cancel Selected
            </button>
          </>
        )}
        {message && <span className="text-[12.5px] text-slate-500">{message}</span>}
      </div>

      <div className="sticky top-0 z-20 glass-card-strong rounded-xl px-3 py-2 flex items-center mb-4">
        <div className="flex items-center gap-1 flex-wrap text-[12.5px] bg-slate-900/[0.03] rounded-lg p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSelected(new Set()); }}
              className={cn(
                'px-3 py-1 rounded-md transition-all duration-[180ms] font-medium border whitespace-nowrap',
                tab === t.key
                  ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] border-[color:var(--color-primary)]/30'
                  : 'bg-white text-slate-500 border-transparent hover:bg-white/70'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
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
