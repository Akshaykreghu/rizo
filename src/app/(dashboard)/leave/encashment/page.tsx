'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { BranchSearch } from '@/components/employees/BranchSearch';
import { LeaveTypeSearch } from '@/components/employees/LeaveTypeSearch';
import { useSetupOptions } from '@/lib/setupOptions';
import { Check, RefreshCw, Ban } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

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

  const { data: branches = [] } = useSetupOptions('setup/branches', 'branch_code', (r) => String(r.branch_name));
  // Leave Type options depend on Employee: no employee selected -> every leave type (branch alone
  // doesn't narrow leave types, only which employees are pickable); one employee selected -> only
  // that employee's own leavepolicy leave types.
  const { data: allItemOptions = [] } = useSetupOptions('setup/leave-types', 'salary_head_item_pkey', (r) => String(r.item));
  const { data: empTypesData } = useQuery<{ data: { salaryHeadItemFkey: number; name: string }[] }>({
    queryKey: ['leave', 'types', filterEmp],
    queryFn: () => fetch(`/api/leave/types?employee=${filterEmp}`).then((r) => r.json()),
    enabled: !!filterEmp,
  });
  const itemOptions = filterEmp
    ? (empTypesData?.data ?? []).map((t) => ({ value: String(t.salaryHeadItemFkey), label: t.name }))
    : allItemOptions;

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

  const bulkApprove = useMutation({
    mutationFn: () =>
      fetch('/api/leave/encashment/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selected),
          approvedDaysById: Object.fromEntries(Array.from(selected).map((id) => [id, overrides[id] ?? rows.find((r) => r.leave_encashment_master_pkey === id)?.requested_days ?? 0])),
          month,
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
    { accessorKey: 'emp_company_id', header: 'Employee ID' },
    { accessorKey: 'emp_name', header: 'Name', cell: ({ getValue }) => <span className="font-medium text-[#0F172A]">{String(getValue())}</span> },
    { accessorKey: 'leave_type', header: 'Leave Type' },
    ...(tab === 'pending'
      ? [
          // Field-for-field match to addleave.ctp's datagrid (addleave.ctp:594-654): "Available
          // Leaves" is the policy's overall encash_days limit, "Applicable Days" is this specific
          // request's eligible amount (available_days) — two distinct columns, not one.
          { accessorKey: 'encash_days', header: 'Available Leaves' } as ColumnDef<EncashRow, unknown>,
          { accessorKey: 'available_days', header: 'Applicable Days' } as ColumnDef<EncashRow, unknown>,
          {
            id: 'encashingNow',
            header: 'Encashing Now',
            cell: ({ row }: { row: { original: EncashRow } }) => {
              const r = row.original;
              const locked = !!r.action && PAYROLL_LOCKED.includes(r.action);
              // Mirrors addleave.ctp's edit()/formatter exactly: when a leaveLimit/cap exists
              // (non-restricted company), the max is (leaveLimit - alreadyEncashed) and the row is
              // only encashable while canEncash && no payroll action && that cap > 0. When there's
              // no cap to enforce (restricted company, or no policy limit), the input is capped at
              // the row's own eligible amount and stays enabled — matching the ctp's else branch.
              const hasCap = r.leaveLimit != null;
              const cap = hasCap ? Math.max(0, r.leaveLimit! - r.alreadyEncashed) : r.available_days;
              const max = Math.min(cap, r.available_days);
              const canEncashRow = r.available_days > 0 && !locked && (!hasCap || (r.canEncash && cap > 0));
              const value = overrides[r.leave_encashment_master_pkey] ?? r.requested_days;
              return (
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={max}
                    step={0.5}
                    disabled={!canEncashRow}
                    value={value}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const v = Math.min(max, Math.max(0, Number(e.target.value) || 0));
                      setOverrides((prev) => ({ ...prev, [r.leave_encashment_master_pkey]: v }));
                    }}
                    className={cn(INPUT_CLASS, 'w-20')}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const approvedDays = overrides[r.leave_encashment_master_pkey] ?? r.requested_days;
                      approveOne.mutate({ id: r.leave_encashment_master_pkey, approvedDays });
                    }}
                    disabled={!canEncashRow}
                    className={cn(BTN_BASE, 'py-1 px-2.5 text-[11.5px]', canEncashRow ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)] hover:opacity-80' : 'bg-slate-100 text-slate-400')}
                  >
                    Encash
                  </button>
                </div>
              );
            },
          } as ColumnDef<EncashRow, unknown>,
        ]
      : [
          // "Encashed" tab columns match listallempsforverified()'s grid (addleave.ctp:692-734):
          // Employee ID/Name/Leave Type (above) + Month (approved_date) + Encashed Leaves (approved_days).
          { id: 'month', header: 'Month', cell: ({ row }) => row.original.approved_date ?? '—' } as ColumnDef<EncashRow, unknown>,
          { accessorKey: 'approved_days', header: 'Encashed Leaves' } as ColumnDef<EncashRow, unknown>,
        ]),
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

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px]">
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
          <BranchSearch
            value={branch}
            onChange={(v) => {
              setBranch(v);
              // Changing branch may drop the previously-selected employee out of scope — clear both
              // the employee and leave-type filters so they don't silently keep a stale selection.
              setFilterEmp('');
              setFilterItem('');
            }}
            branches={branches}
          />
        </div>
        <div className="min-w-[220px]">
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
          <EmployeeSearch
            value={filterEmp}
            onChange={(v) => { setFilterEmp(v); setFilterItem(''); }}
            branch={branch || undefined}
            emptyLabel="All employees"
          />
        </div>
        <div className="min-w-[200px]">
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Leave Type</label>
          <LeaveTypeSearch value={filterItem} onChange={setFilterItem} types={itemOptions} />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={INPUT_CLASS} />
        </div>
        {tab === 'pending' && (
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className={cn(BTN_BASE, 'bg-white border border-slate-200 text-[#0F172A] hover:bg-slate-50')}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Process
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
    </div>
  );
}
