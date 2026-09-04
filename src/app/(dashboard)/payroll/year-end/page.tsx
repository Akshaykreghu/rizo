'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSetupRows } from '@/lib/setupOptions';
import { Archive, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

interface Branch { id: number; branch_code: string; branch_name: string }
interface LeaveItem {
  salaryHeadItemFkey: number;
  name: string;
  allotedLeaveForTheYear: number | null;
  carryForwardLimit: number | null;
  allowNegative: string | null;
  isSandwich: string | null;
  pending: number;
}
interface Group { groupId: number; groupName: string; leaves: LeaveItem[] }
interface YearEndData {
  noFinYear?: true;
  finYear?: { fin_year: number; start_month: string; end_month: string };
  groups?: Group[];
}

const INPUT_CLASS =
  'w-full border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function YearEndPage() {
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [branch, setBranch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [confirmProcess, setConfirmProcess] = useState(false);

  const { data: branches = [] } = useSetupRows<Branch>('setup/branches');

  const { data, isLoading } = useQuery<YearEndData>({
    queryKey: ['payroll/year-end', branch],
    queryFn: () => fetch(`/api/payroll/year-end?branch=${branch}`).then((r) => r.json()),
    enabled: !!branch,
  });

  const totalPending = data?.groups?.reduce((sum, g) => sum + g.leaves.reduce((s, l) => s + l.pending, 0), 0) ?? 0;

  const process = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/payroll/year-end/process', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Year-end processing failed');
      return b;
    },
    onSuccess: () => {
      setMessage('Year-end processed: leave balances carried forward, financial year rolled over.');
      setConfirmProcess(false);
      queryClient.invalidateQueries({ queryKey: ['payroll/year-end'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Year-End Processing
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Clear pending leave and roll over the financial year, by branch
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 max-w-xs">
        <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
        <select
          value={branch}
          onChange={(e) => { setBranch(e.target.value); setConfirmProcess(false); setMessage(null); }}
          className={INPUT_CLASS}
        >
          <option value="">Select branch</option>
          {branches.map((b) => (
            <option key={b.id} value={b.branch_code}>{b.branch_name}</option>
          ))}
        </select>
      </div>

      {message && <p className="text-[12.5px] text-slate-500 mb-4">{message}</p>}

      {!branch ? (
        <p className="text-[13px] text-slate-400">Select a branch to view its year-end checklist.</p>
      ) : isLoading ? (
        <p className="text-[13px] text-slate-400">Loading...</p>
      ) : data?.noFinYear ? (
        <div className="glass-card rounded-2xl p-6 text-[13px] text-slate-500">
          No open financial year found for this branch.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="glass-card rounded-2xl p-4">
            <p className="text-sm font-medium text-[#0F172A]">
              Financial Year {data?.finYear?.fin_year} ({data?.finYear?.start_month} to {data?.finYear?.end_month})
            </p>
            <p className="text-[12.5px] text-slate-400 mt-0.5">
              {totalPending} pending leave request{totalPending === 1 ? '' : 's'} across all leave policies this year.
            </p>
          </div>

          <div className="glass-card rounded-2xl p-5">
            <h2 className="text-[13.5px] font-semibold text-slate-600 uppercase tracking-wide mb-4">Pending Leave Checklist</h2>
            {data?.groups?.map((g) => (
              <div key={g.groupId} className="mb-4 last:mb-0">
                <p className="text-[12.5px] font-medium text-slate-500 mb-1">{g.groupName}</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                        <th className="text-left py-1.5 pr-3 font-semibold">Leave Policy</th>
                        <th className="text-right py-1.5 px-3 font-semibold">Allotted Days</th>
                        <th className="text-right py-1.5 px-3 font-semibold">Carry Forward</th>
                        <th className="text-center py-1.5 px-3 font-semibold">Allow Negative</th>
                        <th className="text-center py-1.5 px-3 font-semibold">Sandwich</th>
                        <th className="text-right py-1.5 pl-3 font-semibold">Pending</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.leaves.map((l) => (
                        <tr key={l.salaryHeadItemFkey} className="border-t border-slate-100">
                          <td className="py-1.5 pr-3 text-[#0F172A]">{l.name}</td>
                          <td className="py-1.5 px-3 text-right text-[#0F172A]">{l.allotedLeaveForTheYear ?? '-'}</td>
                          <td className="py-1.5 px-3 text-right text-[#0F172A]">{l.carryForwardLimit ?? '-'}</td>
                          <td className="py-1.5 px-3 text-center text-[#0F172A]">{l.allowNegative === 'Y' ? 'Yes' : 'No'}</td>
                          <td className="py-1.5 px-3 text-center text-[#0F172A]">{l.isSandwich === 'Y' ? 'Yes' : 'No'}</td>
                          <td className="py-1.5 pl-3 text-right">
                            {l.pending > 0 ? (
                              <Link
                                href={`/leave/requests?status=Applied`}
                                className="inline-flex items-center gap-1 text-[color:var(--color-highlight-dark)] font-medium hover:underline"
                              >
                                {l.pending} pending <ArrowRight className="w-3 h-3" />
                              </Link>
                            ) : (
                              <span className="text-slate-400">0 pending</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          <div className="surface-card rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-3">
            {totalPending > 0 ? (
              <p className="text-[12.5px] text-slate-500">
                Clear all {totalPending} pending leave request{totalPending === 1 ? '' : 's'} above before processing year-end.
              </p>
            ) : !confirmProcess ? (
              <button
                onClick={() => setConfirmProcess(true)}
                className={cn(BTN_BASE, 'bg-[color:var(--color-danger)] hover:bg-[color:var(--color-danger-dark)] text-white')}
              >
                <Archive className="w-3.5 h-3.5" />
                Process Year-End
              </button>
            ) : (
              <span className="flex items-center gap-2 text-[12.5px]">
                <span className="text-slate-500">Carries forward leave balances and closes this financial year. Confirm?</span>
                <button
                  onClick={() => process.mutate()}
                  disabled={process.isPending}
                  className="text-[color:var(--color-danger)] hover:underline font-medium"
                >
                  {process.isPending ? 'Processing…' : 'Yes, process'}
                </button>
                <button onClick={() => setConfirmProcess(false)} className="text-slate-500 hover:underline">
                  Cancel
                </button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
