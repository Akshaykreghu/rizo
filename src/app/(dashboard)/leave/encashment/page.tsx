'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { Plus, Check } from 'lucide-react';

interface BalanceRow {
  salaryHeadItemFkey: number;
  name: string;
  isLeaveEncash: boolean;
  balance: number;
}

interface EncashRow {
  leave_encashment_master_pkey: number;
  emp_name: string;
  leave_type: string;
  encash_days: number;
  available_days: number;
  requested_days: number;
  approved_days: number | null;
  is_approved: 'Y' | 'N';
  approved_date: string | null;
}

export default function LeaveEncashmentPage() {
  const [status, setStatus] = useState('pending');
  const [showApply, setShowApply] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [empFkey, setEmpFkey] = useState('');
  const [reason, setReason] = useState('');
  const [requested, setRequested] = useState<Record<number, string>>({});

  const { data: balancesData } = useQuery<{ data: BalanceRow[] }>({
    queryKey: ['leave', 'balances', empFkey],
    queryFn: () => fetch(`/api/leave/balances?employee=${empFkey}`).then((r) => r.json()),
    enabled: !!empFkey,
  });
  const encashableTypes = (balancesData?.data ?? []).filter((t) => t.isLeaveEncash);

  const { data, isLoading, refetch } = useQuery<{ data: EncashRow[] }>({
    queryKey: ['leave', 'encashment', status],
    queryFn: () => fetch(`/api/leave/encashment?status=${status}`).then((r) => r.json()),
  });
  const rows = data?.data ?? [];

  const apply = useMutation({
    mutationFn: () =>
      fetch('/api/leave/encashment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empFkey: Number(empFkey),
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
    onSuccess: (b) => {
      setMessage(`Encashment request(s) submitted (${b.ids.length})`);
      setShowApply(false);
      setEmpFkey('');
      setRequested({});
      setReason('');
      refetch();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const approve = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/leave/encashment/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? 'Approve failed');
        return b;
      }),
    onSuccess: (b) => { setMessage(b.procMessage ?? 'Approved'); refetch(); },
    onError: (err: Error) => setMessage(err.message),
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Leave Encashment</h1>
        <button
          onClick={() => setShowApply(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> New Request
        </button>
      </div>

      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-1">Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="">All</option>
        </select>
      </div>

      {message && <div className="mb-4 text-sm bg-blue-50 text-blue-700 px-3 py-2 rounded-lg">{message}</div>}

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {!isLoading && rows.length === 0 && <p className="text-sm text-gray-400">No requests found.</p>}
      {rows.length > 0 && (
        <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="p-2">Employee</th>
              <th className="p-2">Leave Type</th>
              <th className="p-2">Requested Days</th>
              <th className="p-2">Approved Days</th>
              <th className="p-2">Status</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.leave_encashment_master_pkey} className="border-t border-gray-100">
                <td className="p-2">{row.emp_name}</td>
                <td className="p-2">{row.leave_type}</td>
                <td className="p-2">{row.requested_days}</td>
                <td className="p-2">{row.approved_days ?? '—'}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${row.is_approved === 'Y' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {row.is_approved === 'Y' ? 'Approved' : 'Pending'}
                  </span>
                </td>
                <td className="p-2">
                  {row.is_approved === 'N' && (
                    <button onClick={() => approve.mutate(row.leave_encashment_master_pkey)} title="Approve" className="text-green-600 hover:text-green-800">
                      <Check className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showApply && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowApply(false)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold mb-4">New Encashment Request</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Employee</label>
                <EmployeeSearch value={empFkey} onChange={setEmpFkey} />
              </div>
              {encashableTypes.length === 0 && empFkey && (
                <p className="text-xs text-gray-400">No encashable leave types configured for this employee&apos;s policy.</p>
              )}
              {encashableTypes.map((t) => (
                <div key={t.salaryHeadItemFkey} className="flex items-center justify-between gap-2">
                  <span className="text-sm">{t.name} <span className="text-gray-400 text-xs">(balance: {t.balance})</span></span>
                  <input
                    type="number"
                    min={0}
                    max={t.balance}
                    step={0.5}
                    value={requested[t.salaryHeadItemFkey] ?? ''}
                    onChange={(e) => setRequested((r) => ({ ...r, [t.salaryHeadItemFkey]: e.target.value }))}
                    className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Reason</label>
                <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <button
              onClick={() => apply.mutate()}
              disabled={!empFkey || encashableTypes.every((t) => !Number(requested[t.salaryHeadItemFkey])) || apply.isPending}
              className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium"
            >
              {apply.isPending ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
