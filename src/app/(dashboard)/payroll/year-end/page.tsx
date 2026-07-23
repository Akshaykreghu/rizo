'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Archive } from 'lucide-react';

interface Branch { id: number; branch_code: string; branch_name: string }
interface LeaveItem { salaryHeadItemFkey: number; name: string; pending: number }
interface Group { groupId: number; groupName: string; leaves: LeaveItem[] }
interface YearEndData {
  noFinYear?: true;
  finYear?: { fin_year: number; start_month: string; end_month: string };
  groups?: Group[];
}

export default function YearEndPage() {
  const queryClient = useQueryClient();
  const [branch, setBranch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [confirmProcess, setConfirmProcess] = useState(false);

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()),
  });

  const { data, isLoading } = useQuery<YearEndData>({
    queryKey: ['payroll/year-end', branch],
    queryFn: () => fetch(`/api/payroll/year-end?branch=${branch}`).then((r) => r.json()),
    enabled: !!branch,
  });

  const totalPending = data?.groups?.reduce((sum, g) => sum + g.leaves.reduce((s, l) => s + l.pending, 0), 0) ?? 0;

  const approveAll = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/payroll/year-end/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Failed to approve pending leave');
      return b;
    },
    onSuccess: () => {
      setMessage('All pending leave requests approved.');
      queryClient.invalidateQueries({ queryKey: ['payroll/year-end'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

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
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Year-End Processing</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 max-w-xs">
        <label className="block text-xs text-gray-500 mb-1">Branch</label>
        <select
          value={branch}
          onChange={(e) => { setBranch(e.target.value); setConfirmProcess(false); setMessage(null); }}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Select branch</option>
          {branches.map((b) => (
            <option key={b.id} value={b.branch_code}>{b.branch_name}</option>
          ))}
        </select>
      </div>

      {message && <p className="text-sm text-gray-600 mb-4">{message}</p>}

      {!branch ? (
        <p className="text-sm text-gray-400">Select a branch to view its year-end checklist.</p>
      ) : isLoading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : data?.noFinYear ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-sm text-gray-600">
          No open financial year found for this branch.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm font-medium text-gray-900">
              Financial Year {data?.finYear?.fin_year} ({data?.finYear?.start_month} to {data?.finYear?.end_month})
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {totalPending} pending leave request{totalPending === 1 ? '' : 's'} across all leave policies this year.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Pending Leave Checklist</h2>
            {data?.groups?.map((g) => (
              <div key={g.groupId} className="mb-3 last:mb-0">
                <p className="text-xs font-medium text-gray-500 mb-1">{g.groupName}</p>
                <table className="w-full text-sm">
                  <tbody>
                    {g.leaves.map((l) => (
                      <tr key={l.salaryHeadItemFkey} className="border-t border-gray-50">
                        <td className="py-1 text-gray-700">{l.name}</td>
                        <td className={`py-1 text-right ${l.pending > 0 ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                          {l.pending} pending
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-wrap items-center gap-3">
            <button
              onClick={() => approveAll.mutate()}
              disabled={totalPending === 0 || approveAll.isPending}
              className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              {approveAll.isPending ? 'Approving…' : 'Auto-Approve All Pending Leave'}
            </button>

            {!confirmProcess ? (
              <button
                onClick={() => setConfirmProcess(true)}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Archive className="w-4 h-4" />
                Process Year-End
              </button>
            ) : (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-gray-600">Carries forward leave balances and closes this financial year. Confirm?</span>
                <button
                  onClick={() => process.mutate()}
                  disabled={process.isPending}
                  className="text-red-600 hover:underline font-medium"
                >
                  {process.isPending ? 'Processing…' : 'Yes, process'}
                </button>
                <button onClick={() => setConfirmProcess(false)} className="text-gray-500 hover:underline">
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
