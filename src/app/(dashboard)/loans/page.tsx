'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, IndianRupee, CheckCircle2, Trash2 } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { formatCurrency } from '@/lib/utils';

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

export default function LoansPage() {
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Employee Loans</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Loan
        </button>
      </div>

      {message && <p className="text-sm text-gray-600 mb-4">{message}</p>}

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
          <div className="max-w-sm">
            <label className="block text-xs text-gray-500 mb-1">Employee</label>
            <EmployeeSearch value={empId} onChange={setEmpId} placeholder="Search employee by name or ID" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Loan Amount (₹)</label>
              <input type="number" value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tenure (months)</label>
              <input type="number" value={tenure} onChange={(e) => setTenure(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Interest Rate (% p.a.)</label>
              <input type="number" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">EMI Start Month</label>
              <input type="month" value={emiStartMonth} onChange={(e) => setEmiStartMonth(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Remarks</label>
              <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <button
            onClick={() => create.mutate()}
            disabled={!empId || !loanAmount || !tenure || !emiStartMonth || create.isPending}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {create.isPending ? 'Creating…' : 'Create Loan'}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tenure</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">EMI</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Period</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Paid</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No loans found.</td></tr>
              )}
              {rows.map((row) => (
                <tr key={row.emp_loan_pkey} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800 font-medium">{row.emp_name}</td>
                  <td className="px-4 py-3 text-gray-700">{formatCurrency(row.loan_amount)}</td>
                  <td className="px-4 py-3 text-gray-700">{row.tenure} mo</td>
                  <td className="px-4 py-3 text-gray-700">{formatCurrency(row.emi_amount)}</td>
                  <td className="px-4 py-3 text-gray-700">{row.emi_start_month} → {row.emi_end_month}</td>
                  <td className="px-4 py-3 text-gray-700">{formatCurrency(row.loan_paid ?? 0)}</td>
                  <td className="px-4 py-3 text-gray-600">{row.is_completed === 'Y' ? 'Completed' : 'Active'}</td>
                  <td className="px-4 py-3 text-right">
                    {row.is_completed !== 'Y' && (
                      <div className="flex items-center justify-end gap-2">
                        <input
                          type="number"
                          placeholder="Amount"
                          value={payAmounts[row.emp_loan_pkey] ?? ''}
                          onChange={(e) => setPayAmounts((prev) => ({ ...prev, [row.emp_loan_pkey]: e.target.value }))}
                          className="w-20 border border-gray-300 rounded px-2 py-1 text-xs"
                        />
                        <button onClick={() => pay.mutate(row.emp_loan_pkey)} title="Record additional payment" className="text-gray-500 hover:text-indigo-600">
                          <IndianRupee className="w-4 h-4" />
                        </button>
                        <button onClick={() => complete.mutate(row.emp_loan_pkey)} title="Mark completed" className="text-gray-500 hover:text-emerald-600">
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => remove.mutate(row.emp_loan_pkey)} title="Remove" className="text-gray-500 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
