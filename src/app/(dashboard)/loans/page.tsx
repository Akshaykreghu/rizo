'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { cn, formatCurrency } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';
import { useSetupOptions } from '@/lib/setupOptions';

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
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [empId, setEmpId] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [tenure, setTenure] = useState('');
  const [interestRate, setInterestRate] = useState('0');
  const [emiStartMonth, setEmiStartMonth] = useState('');
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  // Filters — mirror EmployeeLoanController::employeeloanlist()'s employee / branch / month toolbar.
  const [filterEmpId, setFilterEmpId] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const { data: branches = [] } = useSetupOptions('setup/branches', 'branch_code', 'branch_name');

  const { data, isLoading } = useQuery<{ rows: LoanRow[] }>({
    queryKey: ['loans', filterEmpId, filterBranch, filterMonth],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (filterEmpId) qs.set('empFkey', filterEmpId);
      if (filterBranch) qs.set('branch', filterBranch);
      if (filterMonth) qs.set('month', filterMonth);
      const suffix = qs.toString() ? `?${qs}` : '';
      return fetch(`/api/loans${suffix}`).then((r) => r.json());
    },
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
      meta: { className: 'w-12' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              if (confirm('Remove this loan?')) remove.mutate(row.original.emp_loan_pkey);
            }}
            title="Remove"
            className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
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
              Employee Loans
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Create loans, generate EMI schedules, and record payments
            </p>
          </div>,
          slotEl
        )}

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="min-w-[220px]">
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
          <EmployeeSearch value={filterEmpId} onChange={setFilterEmpId} placeholder="All employees" />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
          <select value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)} className={cn(INPUT_CLASS, 'min-w-[160px]')}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">EMI Start Month</label>
          <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className={INPUT_CLASS} />
        </div>
        {(filterEmpId || filterBranch || filterMonth) && (
          <button
            onClick={() => { setFilterEmpId(''); setFilterBranch(''); setFilterMonth(''); }}
            className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
          >
            Clear
          </button>
        )}
        <button
          onClick={() => setShowForm((v) => !v)}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white ml-auto')}
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

      <DataTable
        data={rows}
        columns={columns}
        pageSize={10}
        pageSizeOptions={[10, 20, 30, 50]}
        isLoading={isLoading}
        onRowClick={(row) => router.push(`/loans/${row.emp_loan_pkey}`)}
      />
    </div>
  );
}
