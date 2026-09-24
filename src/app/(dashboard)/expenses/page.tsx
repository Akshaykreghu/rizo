'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck, CheckCircle2, Clock, Eye, FileText, Paperclip, Plus, Receipt, Search, ShieldCheck, Trash2, X, XCircle,
} from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import type { LucideIcon } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { FileUploadField } from '@/components/employees/FileUploadField';
import { FilePreviewModal } from '@/components/ui/FilePreviewModal';
import { cn, formatCurrency, photoUrl } from '@/lib/utils';
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
  expense_date: string | null;
  vendor: string | null;
  purpose: string | null;
  remarks: string | null;
  image: string | null;
  expense_status: string;
  created_date: string | null;
  authorized_by_name: string;
  approved_by_name: string;
  remarks_auth: string | null;
  remarks_approved: string | null;
  first_name: string;
  last_name: string;
  emp_id: string;
  emp_company_id: string | null;
  profile_pic: string | null;
}

type Action = 'authorize' | 'approve' | 'reject';

type FormState = {
  empFkey: string;
  expenseType: string;
  expensesAmount: string;
  expenseDate: string;
  vendor: string;
  purpose: string;
  remarks: string;
  image: string;
};

const EMPTY_FORM: FormState = {
  empFkey: '', expenseType: '', expensesAmount: '', expenseDate: '', vendor: '', purpose: '', remarks: '', image: '',
};

const STATUS_COLORS: Record<string, string> = {
  Applied: 'bg-[color:var(--color-highlight-light)] text-[color:var(--color-highlight-dark)]',
  Authorized: 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary-dark)]',
  Approved: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)]',
  Rejected: 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-dark)]',
  Removed: 'bg-slate-100 text-slate-500',
};

// Summary cards double as the status filter ('' = all).
const STATUS_CARDS: { key: string; label: string; icon: LucideIcon; tone: string }[] = [
  { key: '', label: 'All Claims', icon: Receipt, tone: 'bg-slate-100 text-slate-600' },
  { key: 'Applied', label: 'Applied', icon: Clock, tone: 'bg-[color:var(--color-highlight-light)] text-[color:var(--color-highlight-dark)]' },
  { key: 'Authorized', label: 'Authorized', icon: ShieldCheck, tone: 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)]' },
  { key: 'Approved', label: 'Approved', icon: BadgeCheck, tone: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)]' },
  { key: 'Rejected', label: 'Rejected', icon: XCircle, tone: 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-dark)]' },
];

const ACTION_CFG: Record<Action, { label: string; icon: LucideIcon; tone: string; btn: string }> = {
  authorize: {
    label: 'Authorize', icon: ShieldCheck,
    tone: 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)]',
    btn: 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)]',
  },
  approve: {
    label: 'Approve', icon: CheckCircle2,
    tone: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)]',
    btn: 'bg-[color:var(--color-success)] hover:bg-[color:var(--color-success-dark)]',
  },
  reject: {
    label: 'Reject', icon: XCircle,
    tone: 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger)]',
    btn: 'bg-[color:var(--color-danger)] hover:bg-[color:var(--color-danger-dark)]',
  },
};

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const ICON_BTN = 'p-1.5 rounded-lg transition-colors duration-[180ms]';

const MODAL_BOX =
  'relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] w-full max-h-[calc(100vh-2rem)] flex flex-col animate-modal-in';

const fullName = (r: ExpenseRow) => `${r.first_name} ${r.last_name ?? ''}`.trim();
const empCode = (r: ExpenseRow) => r.emp_company_id?.trim() || r.emp_id;

function fmtDate(v: string | null | undefined, withTime = false) {
  if (!v || v.startsWith('1970')) return '—';
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  });
}

function Avatar({ row }: { row: ExpenseRow }) {
  const src = photoUrl(row.profile_pic);
  const initials = `${row.first_name?.[0] ?? ''}${row.last_name?.[0] ?? ''}`.toUpperCase();
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
  ) : (
    <span className="w-8 h-8 rounded-full bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] text-[11px] font-bold flex items-center justify-center flex-shrink-0">
      {initials}
    </span>
  );
}

export default function ExpensesPage() {
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [remarksFor, setRemarksFor] = useState<{ row: ExpenseRow; action: Action } | null>(null);
  const [remarks, setRemarks] = useState('');
  const [viewRow, setViewRow] = useState<ExpenseRow | null>(null);
  const [removeRow, setRemoveRow] = useState<ExpenseRow | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Fetch every status once so the summary cards can count them; filtering happens client-side.
  const { data, isLoading } = useQuery<{ data: ExpenseRow[] }>({
    queryKey: ['expenses'],
    queryFn: () => fetch('/api/expenses').then((r) => r.json()),
  });
  const allRows = useMemo(() => data?.data ?? [], [data]);

  const stats = useMemo(() => {
    const out: Record<string, { count: number; total: number }> = {};
    for (const c of STATUS_CARDS) out[c.key] = { count: 0, total: 0 };
    for (const r of allRows) {
      for (const k of ['', r.expense_status]) {
        if (!out[k]) continue;
        out[k].count += 1;
        out[k].total += Number(r.expenses_amount) || 0;
      }
    }
    return out;
  }, [allRows]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (statusFilter && r.expense_status !== statusFilter) return false;
      if (!q) return true;
      return [fullName(r), empCode(r), r.expense_type, r.vendor, r.purpose].some((v) => v?.toLowerCase().includes(q));
    });
  }, [allRows, statusFilter, search]);

  const { data: expenseTypes = [] } = useQuery<ExpenseType[]>({
    queryKey: ['setup/expense-types'],
    queryFn: () => fetch('/api/setup/expense-types').then((r) => r.json()),
  });

  function closeNew() {
    setIsNew(false);
    setForm(EMPTY_FORM);
    create.reset();
  }

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Legacy stores the expense date in both date columns.
        body: JSON.stringify({ ...form, affectedMonth: form.expenseDate }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      closeNew();
    },
  });

  const action = useMutation({
    mutationFn: async ({ id, action: a, remarks: r }: { id: number; action: Action; remarks: string }) => {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setRemoveRow(null);
    },
  });

  function openAction(row: ExpenseRow, a: Action) {
    action.reset();
    setRemarks('');
    setRemarksFor({ row, action: a });
  }

  const columns: ColumnDef<ExpenseRow, unknown>[] = [
    {
      id: 'employee',
      header: 'Employee',
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar row={row.original} />
          <div className="min-w-0">
            <p className="font-medium text-[#0F172A] truncate">{fullName(row.original)}</p>
            <p className="text-[11px] text-slate-400">{empCode(row.original)}</p>
          </div>
        </div>
      ),
    },
    {
      id: 'type',
      header: 'Expense',
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="text-[#0F172A]">{row.original.expense_type}</p>
          {row.original.vendor && <p className="text-[11px] text-slate-400 truncate">{row.original.vendor}</p>}
        </div>
      ),
    },
    {
      id: 'amount',
      header: 'Amount',
      cell: ({ row }) => <span className="font-semibold text-[#0F172A] tabular-nums">{formatCurrency(row.original.expenses_amount)}</span>,
    },
    { id: 'date', header: 'Expense Date', cell: ({ row }) => fmtDate(row.original.expense_date || row.original.affected_month) },
    { id: 'applied', header: 'Applied On', cell: ({ row }) => <span className="text-slate-500">{fmtDate(row.original.created_date, true)}</span> },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap', STATUS_COLORS[row.original.expense_status] ?? 'bg-slate-100 text-slate-600')}>
          {row.original.expense_status}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      meta: { className: 'w-44' },
      cell: ({ row }) => {
        const r = row.original;
        const st = r.expense_status;
        return (
          <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setViewRow(r)} title="View" aria-label="View claim"
              className={cn(ICON_BTN, 'bg-slate-100 text-slate-600 hover:bg-slate-700 hover:text-white')}>
              <Eye className="w-4 h-4" />
            </button>
            {st === 'Applied' && (
              <button onClick={() => openAction(r, 'authorize')} title="Authorize" aria-label="Authorize claim"
                className={cn(ICON_BTN, 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary)] hover:text-white')}>
                <ShieldCheck className="w-4 h-4" />
              </button>
            )}
            {(st === 'Applied' || st === 'Authorized') && (
              <>
                <button onClick={() => openAction(r, 'approve')} title="Approve" aria-label="Approve claim"
                  className={cn(ICON_BTN, 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)] hover:bg-[color:var(--color-success)] hover:text-white')}>
                  <CheckCircle2 className="w-4 h-4" />
                </button>
                <button onClick={() => openAction(r, 'reject')} title="Reject" aria-label="Reject claim"
                  className={cn(ICON_BTN, 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)] hover:text-white')}>
                  <XCircle className="w-4 h-4" />
                </button>
              </>
            )}
            {st !== 'Approved' && (
              <button onClick={() => { remove.reset(); setRemoveRow(r); }} title="Remove" aria-label="Remove claim"
                className={cn(ICON_BTN, 'text-slate-400 hover:bg-[color:var(--color-danger-soft)] hover:text-[color:var(--color-danger)]')}>
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const detail = (label: string, value: React.ReactNode) => (
    <div className="flex gap-3 py-2 border-b border-slate-100 last:border-0">
      <span className="w-32 flex-shrink-0 text-[12px] text-slate-500">{label}</span>
      <span className="text-[12.5px] text-[#0F172A] break-words min-w-0">{value || '—'}</span>
    </div>
  );

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

      {/* Status summary — each card filters the table */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        {STATUS_CARDS.map((c) => {
          const active = statusFilter === c.key;
          const Icon = c.icon;
          return (
            <button
              key={c.key || 'all'}
              onClick={() => setStatusFilter(c.key)}
              className={cn(
                'surface-card rounded-xl px-4 py-3 text-left flex items-center gap-3 transition-all duration-150 border',
                active ? 'border-[color:var(--color-primary)] ring-2 ring-[color:var(--color-primary)]/15' : 'border-transparent hover:border-slate-200'
              )}
            >
              <span className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', c.tone)}>
                <Icon className="w-4.5 h-4.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[11.5px] font-medium text-slate-500">{c.label}</span>
                <span className="block text-[17px] font-bold text-[#0F172A] leading-tight">{stats[c.key]?.count ?? 0}</span>
                <span className="block text-[11px] text-slate-400 truncate">{formatCurrency(stats[c.key]?.total ?? 0)}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee, type, vendor…"
            className={cn(INPUT_CLASS, 'w-full pl-9 py-2')}
          />
        </div>
        <button
          onClick={() => setIsNew(true)}
          className={cn(BTN_BASE, 'ml-auto py-2 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" />
          New Claim
        </button>
      </div>

      <DataTable
        data={rows}
        columns={columns}
        pageSize={10}
        pageSizeOptions={[10, 20, 30, 50]}
        isLoading={isLoading}
        onRowClick={(r) => setViewRow(r)}
      />

      {/* View details */}
      {viewRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setViewRow(null)}>
          <div onClick={(e) => e.stopPropagation()} className={cn(MODAL_BOX, 'max-w-lg')}>
            <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b border-slate-100">
              <Avatar row={viewRow} />
              <div className="min-w-0 flex-1">
                <h2 className="text-[16px] font-semibold text-[#0F172A] truncate">{fullName(viewRow)}</h2>
                <p className="text-[11.5px] text-slate-400">{empCode(viewRow)}</p>
              </div>
              <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-medium', STATUS_COLORS[viewRow.expense_status] ?? 'bg-slate-100 text-slate-600')}>
                {viewRow.expense_status}
              </span>
              <button onClick={() => setViewRow(null)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            <div className="px-6 py-3 overflow-y-auto">
              <div className="rounded-xl bg-slate-50 px-4 py-3 mb-3 flex items-center justify-between">
                <div>
                  <p className="text-[11.5px] text-slate-500">{viewRow.expense_type}</p>
                  <p className="text-[20px] font-bold text-[#0F172A] tabular-nums">{formatCurrency(viewRow.expenses_amount)}</p>
                </div>
                <Receipt className="w-7 h-7 text-slate-300" />
              </div>
              {detail('Expense Date', fmtDate(viewRow.expense_date || viewRow.affected_month))}
              {detail('Applied On', fmtDate(viewRow.created_date, true))}
              {detail('Vendor', viewRow.vendor)}
              {detail('Purpose', viewRow.purpose)}
              {detail('Remarks', viewRow.remarks)}
              {detail('Authorized By', viewRow.authorized_by_name)}
              {viewRow.remarks_auth && detail('Authorizer Remarks', viewRow.remarks_auth)}
              {detail('Approved By', viewRow.approved_by_name)}
              {viewRow.remarks_approved && detail('Approver Remarks', viewRow.remarks_approved)}
              {detail('Attachment', viewRow.image ? (
                <button onClick={() => setPreview(viewRow.image)} className="inline-flex items-center gap-1.5 text-[color:var(--color-primary)] font-medium hover:underline">
                  <Paperclip className="w-3.5 h-3.5" /> View attachment
                </button>
              ) : null)}
            </div>
          </div>
        </div>
      )}

      {/* Authorize / Approve / Reject */}
      {remarksFor && (() => {
        const cfg = ACTION_CFG[remarksFor.action];
        const Icon = cfg.icon;
        const r = remarksFor.row;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setRemarksFor(null)}>
            <div onClick={(e) => e.stopPropagation()} className={cn(MODAL_BOX, 'max-w-sm p-6 overflow-y-auto')}>
              <div className="flex items-center gap-3 mb-4">
                <span className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', cfg.tone)}>
                  <Icon className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-[17px] font-semibold text-[#0F172A] tracking-tight">{cfg.label} Claim</h2>
                  <p className="text-[12px] text-slate-500 truncate">
                    {fullName(r)} · {r.expense_type} · {formatCurrency(r.expenses_amount)}
                  </p>
                </div>
              </div>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Remarks (optional)"
                className={cn(INPUT_CLASS, 'w-full')}
                rows={3}
              />
              {action.isError && <p className="text-[color:var(--color-danger)] text-[12.5px] mt-2">{action.error.message}</p>}
              <div className="flex justify-end gap-2 pt-4">
                <button onClick={() => setRemarksFor(null)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">
                  Cancel
                </button>
                <button
                  onClick={() => action.mutate({ id: r.emp_expenses_pkey, action: remarksFor.action, remarks })}
                  disabled={action.isPending}
                  className={cn(BTN_BASE, cfg.btn, 'text-white')}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {action.isPending ? 'Saving…' : cfg.label}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Remove confirmation */}
      {removeRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setRemoveRow(null)}>
          <div onClick={(e) => e.stopPropagation()} className={cn(MODAL_BOX, 'max-w-sm p-6 text-center')}>
            <span className="w-11 h-11 rounded-full bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger)] flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-5 h-5" />
            </span>
            <h2 className="text-[16px] font-semibold text-[#0F172A]">Remove this claim?</h2>
            <p className="text-[12.5px] text-slate-500 mt-1">
              {fullName(removeRow)} · {removeRow.expense_type} · {formatCurrency(removeRow.expenses_amount)}
            </p>
            {remove.isError && <p className="text-[color:var(--color-danger)] text-[12.5px] mt-2">{remove.error.message}</p>}
            <div className="flex justify-center gap-2 pt-5">
              <button onClick={() => setRemoveRow(null)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">
                Cancel
              </button>
              <button
                onClick={() => remove.mutate(removeRow.emp_expenses_pkey)}
                disabled={remove.isPending}
                className={cn(BTN_BASE, 'bg-[color:var(--color-danger)] hover:bg-[color:var(--color-danger-dark)] text-white')}
              >
                {remove.isPending ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New claim */}
      {isNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={closeNew}>
          <div onClick={(e) => e.stopPropagation()} className={cn(MODAL_BOX, 'max-w-lg')}>
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-lg bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] flex items-center justify-center">
                  <FileText className="w-4.5 h-4.5" />
                </span>
                <h2 className="text-[17px] font-semibold text-[#0F172A] tracking-tight">New Expense Claim</h2>
              </div>
              <button onClick={closeNew} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
              className="flex flex-col min-h-0"
            >
              <div className="px-6 py-4 space-y-4 overflow-y-auto">
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Employee *</label>
                  <EmployeeSearch value={form.empFkey} onChange={(v) => setForm((f) => ({ ...f, empFkey: v }))} placeholder="Search employee..." />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Expense Type *</label>
                    <select
                      required
                      value={form.expenseType}
                      onChange={(e) => setForm((f) => ({ ...f, expenseType: e.target.value }))}
                      className={cn(INPUT_CLASS, 'w-full py-2')}
                    >
                      <option value="">[--Select--]</option>
                      {expenseTypes.map((t) => (
                        <option key={t.expense_type_pkey} value={t.expense_type_name}>{t.expense_type_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Expense Date *</label>
                    <input
                      type="date" required
                      value={form.expenseDate}
                      onChange={(e) => setForm((f) => ({ ...f, expenseDate: e.target.value }))}
                      className={cn(INPUT_CLASS, 'w-full py-2')}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Amount *</label>
                    <input
                      type="number" step="any" min={1} required
                      value={form.expensesAmount}
                      onChange={(e) => setForm((f) => ({ ...f, expensesAmount: e.target.value }))}
                      className={cn(INPUT_CLASS, 'w-full py-2')}
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Vendor</label>
                    <input
                      type="text"
                      value={form.vendor}
                      onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
                      className={cn(INPUT_CLASS, 'w-full py-2')}
                    />
                  </div>
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
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Remarks</label>
                  <textarea
                    value={form.remarks}
                    onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                    className={cn(INPUT_CLASS, 'w-full')}
                    rows={2}
                  />
                </div>
                <FileUploadField label="Receipt" value={form.image} onChange={(path) => setForm((f) => ({ ...f, image: path }))} />

                {create.isError && <p className="text-[color:var(--color-danger)] text-[12.5px]">{create.error.message}</p>}
              </div>

              <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
                <button type="button" onClick={closeNew} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={create.isPending || !form.empFkey}
                  className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
                >
                  {create.isPending ? 'Saving…' : 'Submit Claim'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <FilePreviewModal url={preview} title="Expense attachment" onClose={() => setPreview(null)} />
    </div>
  );
}
