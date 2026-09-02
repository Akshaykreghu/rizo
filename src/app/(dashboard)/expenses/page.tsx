'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { FileUploadField } from '@/components/employees/FileUploadField';
import { cn, formatCurrency } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

interface ExpenseType {
  expense_type_pkey: number;
  expense_type_name: string;
}

interface ExpenseRow {
  emp_expenses_pkey: number;
  emp_fkey: number;
  expense_type: string;
  expenses_amount: number;
  affected_month: string;
  vendor: string | null;
  purpose: string | null;
  image: string | null;
  expense_status: string;
  first_name: string;
  last_name: string;
  emp_id: string;
}

type FormState = {
  empFkey: string;
  expenseType: string;
  expensesAmount: string;
  affectedMonth: string;
  vendor: string;
  purpose: string;
  remarks: string;
  image: string;
};

const EMPTY_FORM: FormState = {
  empFkey: '', expenseType: '', expensesAmount: '', affectedMonth: '', vendor: '', purpose: '', remarks: '', image: '',
};

const STATUS_COLORS: Record<string, string> = {
  Applied: 'bg-[color:var(--color-highlight-light)] text-[color:var(--color-highlight-dark)]',
  Authorized: 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary-dark)]',
  Approved: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)]',
  Rejected: 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-dark)]',
  Removed: 'bg-slate-100 text-slate-500',
};

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function ExpensesPage() {
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [remarksFor, setRemarksFor] = useState<{ id: number; action: 'authorize' | 'approve' | 'reject' } | null>(null);
  const [remarks, setRemarks] = useState('');

  const { data, isLoading } = useQuery<{ data: ExpenseRow[] }>({
    queryKey: ['expenses', statusFilter],
    queryFn: () => fetch(`/api/expenses${statusFilter ? `?status=${statusFilter}` : ''}`).then((r) => r.json()),
  });
  const rows = data?.data ?? [];

  const { data: expenseTypes = [] } = useQuery<ExpenseType[]>({
    queryKey: ['setup/expense-types'],
    queryFn: () => fetch('/api/setup/expense-types').then((r) => r.json()),
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setIsNew(false);
      setForm(EMPTY_FORM);
    },
  });

  const action = useMutation({
    mutationFn: async ({ id, action: a, remarks: r }: { id: number; action: 'authorize' | 'approve' | 'reject'; remarks: string }) => {
      const res = await fetch(`/api/expenses/${id}/${a}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remarks: r }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Action failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setRemarksFor(null);
      setRemarks('');
    },
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Remove failed');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });

  const columns: ColumnDef<ExpenseRow, unknown>[] = [
    { id: 'employee', header: 'Employee', cell: ({ row }) => <>{row.original.first_name} {row.original.last_name} <span className="text-slate-400 text-[11px]">({row.original.emp_id})</span></> },
    { accessorKey: 'expense_type', header: 'Type' },
    { id: 'amount', header: 'Amount', cell: ({ row }) => formatCurrency(row.original.expenses_amount) },
    { id: 'month', header: 'Month', cell: ({ row }) => row.original.affected_month?.slice(0, 7) },
    { id: 'vendor', header: 'Vendor', cell: ({ row }) => row.original.vendor || '—' },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-medium', STATUS_COLORS[row.original.expense_status] ?? 'bg-slate-100 text-slate-600')}>
          {row.original.expense_status}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      meta: { className: 'w-52' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-2.5 text-[11.5px]" onClick={(e) => e.stopPropagation()}>
          {row.original.expense_status === 'Applied' && (
            <button onClick={() => setRemarksFor({ id: row.original.emp_expenses_pkey, action: 'authorize' })} className="text-[color:var(--color-primary)] hover:underline font-medium">
              Authorize
            </button>
          )}
          {(row.original.expense_status === 'Authorized' || row.original.expense_status === 'Applied') && (
            <button onClick={() => setRemarksFor({ id: row.original.emp_expenses_pkey, action: 'approve' })} className="text-[color:var(--color-success-dark)] hover:underline font-medium">
              Approve
            </button>
          )}
          {(row.original.expense_status === 'Applied' || row.original.expense_status === 'Authorized') && (
            <button onClick={() => setRemarksFor({ id: row.original.emp_expenses_pkey, action: 'reject' })} className="text-[color:var(--color-danger)] hover:underline font-medium">
              Reject
            </button>
          )}
          {row.original.expense_status !== 'Approved' && (
            <button onClick={() => remove.mutate(row.original.emp_expenses_pkey)} className="text-slate-500 hover:underline font-medium">
              Remove
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Employee Expenses
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Submit, authorize, and approve expense claims
            </p>
          </div>,
          slotEl
        )}

      <div className="flex items-center justify-end mb-4">
        <button
          onClick={() => setIsNew(true)}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" />
          New Claim
        </button>
      </div>

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 max-w-xs">
        <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Status</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={cn(INPUT_CLASS, 'w-full')}
        >
          <option value="">All</option>
          <option value="Applied">Applied</option>
          <option value="Authorized">Authorized</option>
          <option value="Approved">Approved</option>
          <option value="Rejected">Rejected</option>
        </select>
      </div>

      <DataTable data={rows} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />

      {remarksFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setRemarksFor(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-sm animate-modal-in"
          >
            <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight mb-4 capitalize">{remarksFor.action} Claim</h2>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Remarks (optional)"
              className={cn(INPUT_CLASS, 'w-full')}
              rows={3}
            />
            {action.isError && <p className="text-[color:var(--color-danger)] text-[12.5px] mt-2">{String(action.error)}</p>}
            <div className="flex justify-end gap-2 pt-4">
              <button onClick={() => setRemarksFor(null)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">
                Cancel
              </button>
              <button
                onClick={() => action.mutate({ id: remarksFor.id, action: remarksFor.action, remarks })}
                disabled={action.isPending}
                className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
              >
                {action.isPending ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setIsNew(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-lg animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">New Expense Claim</h2>
              <button onClick={() => setIsNew(false)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Employee</label>
                <EmployeeSearch value={form.empFkey} onChange={(v) => setForm((f) => ({ ...f, empFkey: v }))} placeholder="Search employee..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Expense Type</label>
                  <select
                    required
                    value={form.expenseType}
                    onChange={(e) => setForm((f) => ({ ...f, expenseType: e.target.value }))}
                    className={cn(INPUT_CLASS, 'w-full')}
                  >
                    <option value="">[--Select--]</option>
                    {expenseTypes.map((t) => (
                      <option key={t.expense_type_pkey} value={t.expense_type_name}>{t.expense_type_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Amount</label>
                  <input
                    type="number" step="any" required
                    value={form.expensesAmount}
                    onChange={(e) => setForm((f) => ({ ...f, expensesAmount: e.target.value }))}
                    className={cn(INPUT_CLASS, 'w-full')}
                  />
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Affected Month</label>
                <input
                  type="month" required
                  value={form.affectedMonth ? form.affectedMonth.slice(0, 7) : ''}
                  onChange={(e) => setForm((f) => ({ ...f, affectedMonth: `${e.target.value}-01` }))}
                  className={cn(INPUT_CLASS, 'w-full')}
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Vendor</label>
                <input
                  type="text"
                  value={form.vendor}
                  onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
                  className={cn(INPUT_CLASS, 'w-full')}
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Purpose</label>
                <textarea
                  value={form.purpose}
                  onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                  className={cn(INPUT_CLASS, 'w-full')}
                  rows={2}
                />
              </div>
              <FileUploadField label="Receipt" value={form.image} onChange={(path) => setForm((f) => ({ ...f, image: path }))} />

              {create.isError && <p className="text-[color:var(--color-danger)] text-[12.5px]">{String(create.error)}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setIsNew(false)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={create.isPending}
                  className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
                >
                  {create.isPending ? 'Saving…' : 'Submit Claim'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
