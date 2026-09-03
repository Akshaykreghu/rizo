'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Employee self-service counterpart to /attendance/regularisation — same API, scoped server-side
// to the caller's own emp_fkey. No employee picker (there's only one possible employee: you), no
// branch filter, no approve/reject — that stays admin-only. Requests land in the same admin
// pending queue the admin-raised flow uses (legacy has no manager-approval hierarchy to route
// through first — see the route's comment for why).

interface RegRow {
  id: number;
  att_date: string;
  direction: 'in' | 'out';
  remarks: string | null;
  LOGTIME: string;
  approved: 'P' | 'A' | 'R';
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const STATUS_STYLE: Record<RegRow['approved'], string> = {
  A: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)]',
  R: 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-dark)]',
  P: 'bg-[color:var(--color-highlight-light)] text-[color:var(--color-highlight-dark)]',
};
const STATUS_LABEL: Record<RegRow['approved'], string> = { A: 'Approved', R: 'Rejected', P: 'Pending' };

export default function EssRegularisationPage() {
  const [month, setMonth] = useState(currentMonth());
  const [showRaise, setShowRaise] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ attDate: '', direction: 'in' as 'in' | 'out', logTime: '', remarks: '' });

  const { data, isLoading, refetch } = useQuery<{ data: RegRow[] }>({
    queryKey: ['ess-regularisation', month],
    queryFn: () => fetch(`/api/attendance/regularisation?month=${month}`).then((r) => r.json()),
  });

  const rows = data?.data ?? [];

  const raise = useMutation({
    mutationFn: () =>
      fetch('/api/attendance/regularisation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }).then(async (r) => {
        const resBody = await r.json();
        if (!r.ok) throw new Error(resBody.error ?? 'Failed to raise request');
        return resBody;
      }),
    onSuccess: () => {
      setMessage('Regularisation request raised');
      setShowRaise(false);
      setForm({ attDate: '', direction: 'in', logTime: '', remarks: '' });
      refetch();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-heading text-xl font-bold text-[#0F172A] tracking-tight">Regularisation</h1>
          <p className="text-[12.5px] text-slate-500 mt-0.5">Raise a request to fix a missed punch</p>
        </div>
        <button
          onClick={() => setShowRaise(true)}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" /> Raise Request
        </button>
      </div>

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={INPUT_CLASS} />
        </div>
        {message && <span className="text-[12.5px] text-slate-500">{message}</span>}
      </div>

      <div className="surface-card rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">No requests for this month</div>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-500">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Direction</th>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Remarks</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2">{row.att_date}</td>
                  <td className="px-4 py-2 capitalize">{row.direction}</td>
                  <td className="px-4 py-2">{row.LOGTIME}</td>
                  <td className="px-4 py-2 text-slate-500">{row.remarks}</td>
                  <td className="px-4 py-2">
                    <span className={cn('px-2 py-0.5 rounded text-[11px] font-medium', STATUS_STYLE[row.approved])}>
                      {STATUS_LABEL[row.approved]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showRaise && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setShowRaise(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">Raise Regularisation</h2>
              <button onClick={() => setShowRaise(false)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Date</label>
                <input type="date" value={form.attDate} onChange={(e) => setForm((f) => ({ ...f, attDate: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')} />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Direction</label>
                <select value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value as 'in' | 'out' }))} className={cn(INPUT_CLASS, 'w-full')}>
                  <option value="in">In</option>
                  <option value="out">Out</option>
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Time</label>
                <input type="time" step="1" value={form.logTime} onChange={(e) => setForm((f) => ({ ...f, logTime: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')} />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Remarks</label>
                <input type="text" value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')} />
              </div>
            </div>
            <button
              onClick={() => raise.mutate()}
              disabled={!form.attDate || !form.logTime || raise.isPending}
              className={cn(BTN_BASE, 'w-full justify-center mt-4 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
            >
              {raise.isPending ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
