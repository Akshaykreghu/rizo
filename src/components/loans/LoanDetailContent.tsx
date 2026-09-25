'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';

interface LoanScheduleRow {
  emp_loan_info_pkey: number;
  sl_no: number;
  loan_month: string;
  opening_balance: number;
  loan_emi: number;
  amount_paid: number;
  closing_balance: number;
  monthly_status: string;
  user_remarks: string;
}

interface LoanDetail {
  emp_loan_pkey: number;
  emp_fkey: number;
  emp_name: string;
  emp_company_id: string | null;
  loan_amount: number;
  tenure: number;
  intrest_rate: number;
  emi_amount: number;
  emi_start_month: string;
  emi_end_month: string;
  remarks: string | null;
  is_completed: string;
  created_date: string;
  paid: number;
  balance_amount: number;
  completion_pct: number;
  schedule: LoanScheduleRow[];
}

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

function monthLabel(ym: string) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${m}-${y}`;
}

// Loan header + payment/completion actions + EMI schedule ledger. Shared by the standalone
// /loans/[id] page and the "view" modal on the Loans list — same data, same mutations, just a
// different shell around it.
export function LoanDetailContent({ loanId }: { loanId: number }) {
  const queryClient = useQueryClient();
  const [payAmount, setPayAmount] = useState('');
  const [payRemarks, setPayRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const { data: loan, isLoading, error } = useQuery<LoanDetail>({
    queryKey: ['loan', loanId],
    queryFn: async () => {
      const res = await fetch(`/api/loans/${loanId}`);
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Failed to load loan');
      return b as LoanDetail;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['loan', loanId] });
    queryClient.invalidateQueries({ queryKey: ['loans'] });
  };

  const pay = useMutation({
    mutationFn: async () => {
      const amount = Number(payAmount);
      const remarks = payRemarks.trim();
      if (!amount || amount <= 0) throw new Error('Enter a valid amount');
      if (!remarks) throw new Error('Enter remarks for the additional payment');
      const res = await fetch(`/api/loans/${loanId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, remarks }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Payment failed');
      return b;
    },
    onSuccess: () => {
      setMessage('Additional payment recorded.');
      setPayAmount('');
      setPayRemarks('');
      invalidate();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const complete = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/loans/${loanId}/complete`, { method: 'POST' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? 'Failed to mark completed');
      }
    },
    onSuccess: () => {
      setMessage('Loan marked completed.');
      invalidate();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const canAct = loan && loan.is_completed !== 'Y' && loan.balance_amount > 0;

  return (
    <div>
      {message && <p className="text-[12.5px] text-slate-500 mb-4">{message}</p>}
      {isLoading && <p className="text-[12.5px] text-slate-500">Loading…</p>}
      {error && <p className="text-[12.5px] text-[color:var(--color-danger)]">{(error as Error).message}</p>}

      {loan && (
        <div className="space-y-4">
          <div>
            <h2 className="font-heading text-lg font-bold text-[#0F172A] tracking-tight pr-10">{loan.emp_name}&apos;s Loan</h2>
            <p className="text-[12.5px] text-slate-500 mt-0.5">EMI schedule and repayment ledger</p>
          </div>

          <div className="surface-card rounded-xl p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
              <Field label="Employee" value={loan.emp_name} />
              <Field label="Employee ID" value={loan.emp_company_id ?? '—'} />
              <Field label="Loan Amount" value={formatCurrency(loan.loan_amount)} />
              <Field label="Tenure" value={`${loan.tenure} months`} />
              <Field label="Interest Rate" value={`${loan.intrest_rate || 0}%`} />
              <Field label="EMI" value={formatCurrency(loan.emi_amount)} />
              <Field label="Period" value={`${monthLabel(loan.emi_start_month)} → ${monthLabel(loan.emi_end_month)}`} />
              <Field label="Status" value={loan.is_completed === 'Y' ? 'Completed' : 'Active'} />
            </div>
            {loan.remarks && (
              <p className="text-[12.5px] text-slate-500 mt-3">
                <span className="font-medium text-slate-600">Remarks:</span> {loan.remarks}
              </p>
            )}
          </div>

          <div className="surface-card rounded-xl p-4">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[12.5px] font-medium text-slate-600">Amount to be paid</span>
              <span className="text-lg font-bold text-[#0F172A]">{formatCurrency(loan.balance_amount)}</span>
            </div>
            <div className="flex items-baseline justify-between mb-2 text-[11.5px] text-slate-500">
              <span>Paid {formatCurrency(loan.paid)} of {formatCurrency(loan.loan_amount)}</span>
              <span>{loan.completion_pct}% completed</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-[color:var(--color-success-dark)] transition-all"
                style={{ width: `${loan.completion_pct}%` }}
              />
            </div>
          </div>

          {canAct && (
            <div className="surface-card rounded-xl p-4">
              <h2 className="text-[12.5px] font-semibold text-slate-600 mb-3">Additional payment for this month</h2>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Amount (₹)</label>
                  <input
                    type="number"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className={cn(INPUT_CLASS, 'w-32')}
                  />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Remarks</label>
                  <input
                    type="text"
                    value={payRemarks}
                    onChange={(e) => setPayRemarks(e.target.value)}
                    className={cn(INPUT_CLASS, 'w-full')}
                  />
                </div>
                <button
                  onClick={() => pay.mutate()}
                  disabled={pay.isPending}
                  className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
                >
                  {pay.isPending ? 'Saving…' : 'Record payment'}
                </button>
                <button
                  onClick={() => {
                    if (confirm('Mark this loan as completed? Remaining EMIs will be closed out.')) complete.mutate();
                  }}
                  disabled={complete.isPending}
                  className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Mark completed
                </button>
              </div>
            </div>
          )}

          <div className="surface-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11.5px] font-medium text-slate-500">
                    <th className="px-4 py-2.5 w-14">Sl No</th>
                    <th className="px-4 py-2.5">Month</th>
                    <th className="px-4 py-2.5 text-right">Opening Balance</th>
                    <th className="px-4 py-2.5 text-right">EMI</th>
                    <th className="px-4 py-2.5 text-right">Paid Amount</th>
                    <th className="px-4 py-2.5 text-right">Closing Balance</th>
                    <th className="px-4 py-2.5">Monthly Status</th>
                    <th className="px-4 py-2.5">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {loan.schedule.map((r) => (
                    <tr key={r.emp_loan_info_pkey} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2.5 text-slate-500">{r.sl_no}</td>
                      <td className="px-4 py-2.5">{monthLabel(r.loan_month)}</td>
                      <td className="px-4 py-2.5 text-right">{formatCurrency(r.opening_balance)}</td>
                      <td className="px-4 py-2.5 text-right">{formatCurrency(r.loan_emi)}</td>
                      <td className="px-4 py-2.5 text-right">{formatCurrency(r.amount_paid)}</td>
                      <td className="px-4 py-2.5 text-right">{formatCurrency(r.closing_balance)}</td>
                      <td className="px-4 py-2.5 text-slate-500">{r.monthly_status}</td>
                      <td className="px-4 py-2.5 text-slate-500">{r.user_remarks}</td>
                    </tr>
                  ))}
                  {loan.schedule.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-slate-400">No EMI rows.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-[13px] text-[#0F172A] mt-0.5 truncate">{value}</p>
    </div>
  );
}
