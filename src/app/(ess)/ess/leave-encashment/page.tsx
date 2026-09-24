'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EssPagination } from '@/components/ess/EssPagination';
import { essPortal } from '@/components/ess/essPortal';

const PAGE_SIZE = 10;

// Employee self-service counterpart to /leave/encashment — same API, scoped server-side to the
// caller's own emp_fkey (see the route's ESS-scoping comment). No employee picker (there's only
// one possible employee: you), no branch/bulk-generate (that's the HR grid's job).

interface BalanceRow {
  salaryHeadItemFkey: number;
  name: string;
  isLeaveEncash: boolean;
  balance: number;
}

interface EncashRow {
  leave_encashment_master_pkey: number;
  leave_type: string;
  requested_days: number;
  approved_days: number | null;
  is_approved: 'Y' | 'N';
  approved_date: string | null;
}

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
] as const;

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const STATUS_STYLE: Record<EncashRow['is_approved'], string> = {
  Y: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)]',
  N: 'bg-[color:var(--color-highlight-light)] text-[color:var(--color-highlight-dark)]',
};

export default function EssLeaveEncashmentPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('pending');
  const [showApply, setShowApply] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [requested, setRequested] = useState<Record<number, string>>({});
  const [page, setPage] = useState(1);

  const { data: balancesData } = useQuery<{ data: BalanceRow[] }>({
    queryKey: ['ess-leave-balances'],
    queryFn: () => fetch('/api/leave/balances').then((r) => r.json()),
  });
  const encashableTypes = (balancesData?.data ?? []).filter((t) => t.isLeaveEncash);

  const { data, isLoading, refetch } = useQuery<{ data: EncashRow[] }>({
    queryKey: ['ess-leave-encashment', tab],
    queryFn: () => fetch(`/api/leave/encashment?tab=${tab}`).then((r) => r.json()),
  });
  const rows = data?.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['ess-leave-encashment'] });

  const apply = useMutation({
    mutationFn: () =>
      fetch('/api/leave/encashment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
    onSuccess: () => {
      setMessage('Encashment request submitted');
      setShowApply(false);
      setRequested({});
      setReason('');
      setTab('pending');
      setPage(1);
      invalidate();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const cancel = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/leave/encashment/${id}/cancel`, { method: 'POST' }).then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? 'Cancel failed');
        return b;
      }),
    onSuccess: () => { setMessage('Request cancelled'); refetch(); },
    onError: (err: Error) => setMessage(err.message),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-heading text-xl font-bold text-[#0F172A] tracking-tight">Leave Encashment</h1>
          <p className="text-[12.5px] text-slate-500 mt-0.5">Apply for and track your leave encashment</p>
        </div>
        <button
          onClick={() => setShowApply(true)}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" /> New Request
        </button>
      </div>

      <div className="flex items-center gap-1 flex-wrap text-[12.5px] bg-slate-900/[0.03] rounded-lg p-0.5 mb-4 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setPage(1); }}
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

      {message && <p className="text-[12.5px] text-slate-500 mb-3">{message}</p>}

      <div className="surface-card rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">No requests</div>
        ) : (
          <>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-500">
                  <th className="px-4 py-2 font-medium">Sl.No</th>
                  <th className="px-4 py-2 font-medium">Leave Type</th>
                  <th className="px-4 py-2 font-medium">Requested</th>
                  <th className="px-4 py-2 font-medium">Approved</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((row, i) => (
                  <tr key={row.leave_encashment_master_pkey} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2">{(page - 1) * PAGE_SIZE + i + 1}</td>
                    <td className="px-4 py-2">{row.leave_type}</td>
                    <td className="px-4 py-2">{row.requested_days}</td>
                    <td className="px-4 py-2">{row.approved_days ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span className={cn('px-2 py-0.5 rounded text-[11px] font-medium', STATUS_STYLE[row.is_approved])}>
                        {row.is_approved === 'Y' ? 'Approved' : 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {row.is_approved === 'N' && (
                        <button
                          onClick={() => cancel.mutate(row.leave_encashment_master_pkey)}
                          className="text-[color:var(--color-danger)] hover:underline"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <EssPagination page={page} pageSize={PAGE_SIZE} totalItems={rows.length} onChange={setPage} />
          </>
        )}
      </div>

      {showApply && essPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 backdrop-blur-[4px] p-4 animate-fade-in" onClick={() => setShowApply(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md max-h-[90vh] overflow-y-auto animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">New Encashment Request</h2>
              <button onClick={() => setShowApply(false)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            <div className="space-y-3">
              {encashableTypes.length === 0 && (
                <p className="text-[12px] text-slate-400">No encashable leave types configured for your policy.</p>
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
              disabled={encashableTypes.every((t) => !Number(requested[t.salaryHeadItemFkey])) || apply.isPending}
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
