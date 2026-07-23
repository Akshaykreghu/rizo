'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { Plus, Check, X } from 'lucide-react';

interface Option { value: string; label: string }

function useLookup(path: string, valueKey: string, labelFn: (r: Record<string, unknown>) => string) {
  return useQuery<Option[]>({
    queryKey: [path],
    queryFn: () => fetch(`/api/${path}`).then((r) => r.json()).then((rows: Record<string, unknown>[]) =>
      rows.map((r) => ({ value: String(r[valueKey]), label: labelFn(r) }))
    ),
  });
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface RegRow {
  id: number;
  att_date: string;
  direction: 'in' | 'out';
  remarks: string | null;
  LOGTIME: string;
  approved: 'P' | 'A' | 'R';
  first_name: string;
  last_name: string;
  emp_id: string;
  branch_name: string | null;
}

export default function RegularisationPage() {
  const [month, setMonth] = useState(currentMonth());
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('pending');
  const [showRaise, setShowRaise] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ empFkey: '', attDate: '', direction: 'in' as 'in' | 'out', logTime: '', remarks: '' });

  const { data: branches = [] } = useLookup('setup/branches', 'branch_code', (r) => String(r.branch_name));

  const { data, isLoading, refetch } = useQuery<{ data: RegRow[] }>({
    queryKey: ['regularisation', month, branch, status],
    queryFn: () => fetch(`/api/attendance/regularisation?month=${month}&branch=${branch}&status=${status}`).then((r) => r.json()),
  });

  const rows = data?.data ?? [];

  const raise = useMutation({
    mutationFn: () =>
      fetch('/api/attendance/regularisation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, empFkey: Number(form.empFkey) }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to raise request');
        return body;
      }),
    onSuccess: () => {
      setMessage('Regularisation request raised');
      setShowRaise(false);
      setForm({ empFkey: '', attDate: '', direction: 'in', logTime: '', remarks: '' });
      refetch();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const decide = useMutation({
    mutationFn: (vars: { id: number; decision: 'approve' | 'reject' }) =>
      fetch(`/api/attendance/regularisation/${vars.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: vars.decision }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to update request');
        return body;
      }),
    onSuccess: () => { refetch(); },
    onError: (err: Error) => setMessage(err.message),
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Regularisation</h1>
        <button
          onClick={() => setShowRaise(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> Raise Regularisation
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Branch</label>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm min-w-[160px]">
            <option value="">All branches</option>
            {branches.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="">All</option>
          </select>
        </div>
      </div>

      {message && <div className="mb-4 text-sm bg-blue-50 text-blue-700 px-3 py-2 rounded-lg">{message}</div>}

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {!isLoading && rows.length === 0 && <p className="text-sm text-gray-400">No requests found.</p>}
      {rows.length > 0 && (
        <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="p-2">Employee</th>
              <th className="p-2">Branch</th>
              <th className="p-2">Date</th>
              <th className="p-2">Direction</th>
              <th className="p-2">Time</th>
              <th className="p-2">Remarks</th>
              <th className="p-2">Status</th>
              {status === 'pending' && <th className="p-2">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-gray-100">
                <td className="p-2">{row.first_name} {row.last_name} <span className="text-gray-400 text-xs">({row.emp_id})</span></td>
                <td className="p-2">{row.branch_name}</td>
                <td className="p-2">{row.att_date}</td>
                <td className="p-2 capitalize">{row.direction}</td>
                <td className="p-2">{row.LOGTIME}</td>
                <td className="p-2 text-gray-500">{row.remarks}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${row.approved === 'A' ? 'bg-green-100 text-green-700' : row.approved === 'R' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {row.approved === 'A' ? 'Approved' : row.approved === 'R' ? 'Rejected' : 'Pending'}
                  </span>
                </td>
                {status === 'pending' && (
                  <td className="p-2 flex gap-2">
                    <button onClick={() => decide.mutate({ id: row.id, decision: 'approve' })} className="text-green-600 hover:text-green-800">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => decide.mutate({ id: row.id, decision: 'reject' })} className="text-red-600 hover:text-red-800">
                      <X className="w-4 h-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showRaise && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowRaise(false)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold mb-4">Raise Regularisation</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Employee</label>
                <EmployeeSearch value={form.empFkey} onChange={(v) => setForm((f) => ({ ...f, empFkey: v }))} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date</label>
                <input type="date" value={form.attDate} onChange={(e) => setForm((f) => ({ ...f, attDate: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Direction</label>
                <select value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value as 'in' | 'out' }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="in">In</option>
                  <option value="out">Out</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Time</label>
                <input type="time" step="1" value={form.logTime} onChange={(e) => setForm((f) => ({ ...f, logTime: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Remarks</label>
                <input type="text" value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <button
              onClick={() => raise.mutate()}
              disabled={!form.empFkey || !form.attDate || !form.logTime || raise.isPending}
              className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium"
            >
              {raise.isPending ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
