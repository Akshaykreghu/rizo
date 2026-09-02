'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, IndianRupee, CheckCircle2, Trash2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { cn, formatCurrency } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

interface LoanRow {
  emp_loan_pkey: number;
  emp_fkey: number;
  emp_name: string;
  loan_amount: number;
  tenure: number;
  intrest_rate: number;
  emi_amount: number;
  emi_start_month: string;
  emi_end_month: string;
  is_completed: string;
  loan_paid: number | null;
}

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function LoansPage() {
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [empId, setEmpId] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [tenure, setTenure] = useState('');
  const [interestRate, setInterestRate] = useState('0');
  const [emiStartMonth, setEmiStartMonth] = useState('');
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [payAmounts, setPayAmounts] = useState<Record<number, string>>({});

  const { data, isLoading } = useQuery<{ rows: LoanRow[] }>({
    queryKey: ['loans'],
    queryFn: () => fetch('/api/loans').then((r) => r.json()),
  });
  const rows = data?.rows ?? [];

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/loans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empFkey: Number(empId), loanAmount: Number(loanAmount), tenure: Number(tenure),
          interestRate: Number(interestRate), emiStartMonth, remarks: remarks || undefined,
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Failed to create loan');
      return b;
    },
    onSuccess: () => {
      setMessage('Loan created and EMI schedule generated.');
      setShowForm(false);
      setEmpId(''); setLoanAmount(''); setTenure(''); setInterestRate('0'); setEmiStartMonth(''); setRemarks('');
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const pay = useMutation({
    mutationFn: async (id: number) => {
      const amount = Number(payAmounts[id] ?? 0);
      const res = await fetch(`/api/loans/${id}/pay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Payment failed');
      return b;
    },
    onSuccess: () => {
      setMessage('Additional payment recorded.');
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const complete = useMutation({
    mutationFn: (id: number) => fetch(`/api/loans/${id}/complete`, { method: 'POST' }),
    onSuccess: () => {
      setMessage('Loan marked completed.');
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => fetch(`/api/loans/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setMessage('Loan removed.');
      queryClient.invalidateQueries({ queryKey: ['loans'] });
    },
  });

  const columns: ColumnDef<LoanRow, unknown>[] = [
    { accessorKey: 'emp_name', header: 'Employee', cell: ({ getValue }) => <span className="font-medium text-[#0F172A]">{String(getValue())}</span> },
    { id: 'amount', header: 'Amount', cell: ({ row }) => formatCurrency(row.original.loan_amount) },
    { id: 'tenure', header: 'Tenure', cell: ({ row }) => `${row.original.tenure} mo` },
    { id: 'emi', header: 'EMI', cell: ({ row }) => formatCurrency(row.original.emi_amount) },
    { id: 'period', header: 'Period', cell: ({ row }) => `${row.original.emi_start_month} → ${row.original.emi_end_month}` },
    { id: 'paid', header: 'Paid', cell: ({ row }) => formatCurrency(row.original.loan_paid ?? 0) },
    { id: 'status', header: 'Status', cell: ({ row }) => (row.original.is_completed === 'Y' ? 'Completed' : 'Active') },
    {
      id: 'actions',
      header: '',
      meta: { className: 'w-44' },
      cell: ({ row }) => (
        row.original.is_completed !== 'Y' ? (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <input
              type="number"
              placeholder="Amount"
              value={payAmounts[row.original.emp_loan_pkey] ?? ''}
              onChange={(e) => setPayAmounts((prev) => ({ ...prev, [row.original.emp_loan_pkey]: e.target.value }))}
              className={cn(INPUT_CLASS, 'w-20')}
            />
            <button onClick={() => pay.mutate(row.original.emp_loan_pkey)} title="Record additional payment" className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150">
              <IndianRupee className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => complete.mutate(row.original.emp_loan_pkey)} title="Mark completed" className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-success-dark)] hover:bg-[color:var(--color-success-soft)] transition-colors duration-150">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => remove.mutate(row.original.emp_loan_pkey)} title="Remove" className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
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
              Employee Loans
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Create loans, generate EMI schedules, and record payments
            </p>
          </div>,
          slotEl
        )}

      <div className="flex items-center justify-end mb-4">
        <button
          onClick={() => setShowForm((v) => !v)}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" />
          New Loan
        </button>
      </div>

      {message && <p className="text-[12.5px] text-slate-500 mb-4">{message}</p>}

      {showForm && (
        <div className="surface-card rounded-xl p-4 mb-4 space-y-3">
          <div className="max-w-sm">
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
            <EmployeeSearch value={empId} onChange={setEmpId} placeholder="Search employee by name or ID" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Loan Amount (₹)</label>
              <input type="number" value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)} className={cn(INPUT_CLASS, 'w-full')} />
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Tenure (months)</label>
              <input type="number" value={tenure} onChange={(e) => setTenure(e.target.value)} className={cn(INPUT_CLASS, 'w-full')} />
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Interest Rate (% p.a.)</label>
              <input type="number" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} className={cn(INPUT_CLASS, 'w-full')} />
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">EMI Start Month</label>
              <input type="month" value={emiStartMonth} onChange={(e) => setEmiStartMonth(e.target.value)} className={cn(INPUT_CLASS, 'w-full')} />
            </div>
            <div className="col-span-2">
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Remarks</label>
              <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={cn(INPUT_CLASS, 'w-full')} />
            </div>
          </div>
          <button
            onClick={() => create.mutate()}
            disabled={!empId || !loanAmount || !tenure || !emiStartMonth || create.isPending}
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
          >
            {create.isPending ? 'Creating…' : 'Create Loan'}
          </button>
        </div>
      )}

      <DataTable data={rows} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />
    </div>
  );
}
