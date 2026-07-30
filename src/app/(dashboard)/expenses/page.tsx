'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { FileUploadField } from '@/components/employees/FileUploadField';
import { cn, formatCurrency } from '@/lib/utils';

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
  Applied: 'bg-amber-50 text-amber-700',
  Authorized: 'bg-blue-50 text-blue-700',
  Approved: 'bg-green-50 text-green-700',
  Rejected: 'bg-red-50 text-red-700',
  Removed: 'bg-gray-100 text-gray-500',
};

export default function ExpensesPage() {
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Employee Expenses</h1>
        <button
          onClick={() => setIsNew(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Claim
        </button>
      </div>

      <div className="mb-4 max-w-xs">
        <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All</option>
          <option value="Applied">Applied</option>
          <option value="Authorized">Authorized</option>
          <option value="Approved">Approved</option>
          <option value="Rejected">Rejected</option>
        </select>
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Month</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Vendor</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">No expense claims found.</td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.emp_expenses_pkey} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">{r.first_name} {r.last_name} <span className="text-gray-400">({r.emp_id})</span></td>
                  <td className="px-4 py-3 text-gray-600">{r.expense_type}</td>
                  <td className="px-4 py-3 text-gray-600">{formatCurrency(r.expenses_amount)}</td>
                  <td className="px-4 py-3 text-gray-600">{r.affected_month?.slice(0, 7)}</td>
                  <td className="px-4 py-3 text-gray-600">{r.vendor || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[r.expense_status] ?? 'bg-gray-100 text-gray-600')}>
                      {r.expense_status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2 text-xs">
                      {r.expense_status === 'Applied' && (
                        <button onClick={() => setRemarksFor({ id: r.emp_expenses_pkey, action: 'authorize' })} className="text-blue-600 hover:underline">
                          Authorize
                        </button>
                      )}
                      {(r.expense_status === 'Authorized' || r.expense_status === 'Applied') && (
                        <button onClick={() => setRemarksFor({ id: r.emp_expenses_pkey, action: 'approve' })} className="text-green-600 hover:underline">
                          Approve
                        </button>
                      )}
                      {(r.expense_status === 'Applied' || r.expense_status === 'Authorized') && (
                        <button onClick={() => setRemarksFor({ id: r.emp_expenses_pkey, action: 'reject' })} className="text-red-600 hover:underline">
                          Reject
                        </button>
                      )}
                      {r.expense_status !== 'Approved' && (
                        <button onClick={() => remove.mutate(r.emp_expenses_pkey)} className="text-gray-500 hover:underline">
                          Remove
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {remarksFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRemarksFor(null)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 capitalize">{remarksFor.action} Claim</h2>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Remarks (optional)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              rows={3}
            />
            {action.isError && <p className="text-red-500 text-sm mt-2">{String(action.error)}</p>}
            <div className="flex justify-end gap-3 pt-4">
              <button onClick={() => setRemarksFor(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                Cancel
              </button>
              <button
                onClick={() => action.mutate({ id: remarksFor.id, action: remarksFor.action, remarks })}
                disabled={action.isPending}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400"
              >
                {action.isPending ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setIsNew(false)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">New Expense Claim</h2>
              <button onClick={() => setIsNew(false)} className="p-1 rounded hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-500" />
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                <EmployeeSearch value={form.empFkey} onChange={(v) => setForm((f) => ({ ...f, empFkey: v }))} placeholder="Search employee..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expense Type</label>
                  <select
                    required
                    value={form.expenseType}
                    onChange={(e) => setForm((f) => ({ ...f, expenseType: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">[--Select--]</option>
                    {expenseTypes.map((t) => (
                      <option key={t.expense_type_pkey} value={t.expense_type_name}>{t.expense_type_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                  <input
                    type="number" step="any" required
                    value={form.expensesAmount}
                    onChange={(e) => setForm((f) => ({ ...f, expensesAmount: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Affected Month</label>
                <input
                  type="month" required
                  value={form.affectedMonth ? form.affectedMonth.slice(0, 7) : ''}
                  onChange={(e) => setForm((f) => ({ ...f, affectedMonth: `${e.target.value}-01` }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
                <input
                  type="text"
                  value={form.vendor}
                  onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Purpose</label>
                <textarea
                  value={form.purpose}
                  onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  rows={2}
                />
              </div>
              <FileUploadField label="Receipt" value={form.image} onChange={(path) => setForm((f) => ({ ...f, image: path }))} />

              {create.isError && <p className="text-red-500 text-sm">{String(create.error)}</p>}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsNew(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={create.isPending}
                  className={cn('px-4 py-2 text-sm font-medium text-white rounded-lg', create.isPending ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700')}
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
