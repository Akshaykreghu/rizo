'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { RefreshCw, RotateCcw, Plus } from 'lucide-react';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface PunchRow {
  device_attandance_seq: number;
  LOGDATE: string;
  direction: string;
  SHIFTDATE: string;
}

export default function EditPunchesPage() {
  const [empFkey, setEmpFkey] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [message, setMessage] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ logDate: '', logTime: '', direction: 'in' as 'in' | 'out' });

  const { data, isLoading, refetch } = useQuery<{ data: PunchRow[] }>({
    queryKey: ['punches', empFkey, month],
    queryFn: () => fetch(`/api/attendance/punches?empFkey=${empFkey}&month=${month}`).then((r) => r.json()),
    enabled: !!empFkey,
  });

  const sync = useMutation({
    mutationFn: () => fetch('/api/attendance/punches/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empFkey: Number(empFkey), month }),
    }).then((r) => r.json()),
    onSuccess: (result) => { setMessage(result.message ?? 'Synced'); refetch(); },
  });

  const resync = useMutation({
    mutationFn: () => fetch('/api/attendance/punches/resync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empFkey: Number(empFkey), month }),
    }).then((r) => r.json()),
    onSuccess: (result) => { setMessage(result.message ?? 'Re-synced'); refetch(); },
  });

  const addPunch = useMutation({
    mutationFn: () => fetch('/api/attendance/punches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empFkey: Number(empFkey), ...addForm }),
    }).then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? 'Failed to add punch');
      return body;
    }),
    onSuccess: () => { setShowAdd(false); setAddForm({ logDate: '', logTime: '', direction: 'in' }); refetch(); },
    onError: (err: Error) => setMessage(err.message),
  });

  const editShiftDate = useMutation({
    mutationFn: (vars: { id: number; shiftDate: string }) =>
      fetch(`/api/attendance/punches/${vars.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftDate: vars.shiftDate }),
      }).then((r) => r.json()),
    onSuccess: () => refetch(),
  });

  const rows = data?.data ?? [];

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Edit Punches</h1>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="w-72">
          <label className="block text-xs text-gray-500 mb-1">Employee</label>
          <EmployeeSearch value={empFkey} onChange={setEmpFkey} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <button onClick={() => sync.mutate()} disabled={!empFkey || sync.isPending} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-medium">
          <RefreshCw className="w-4 h-4" /> Sync
        </button>
        <button onClick={() => resync.mutate()} disabled={!empFkey || resync.isPending} className="flex items-center gap-2 bg-gray-600 hover:bg-gray-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-medium">
          <RotateCcw className="w-4 h-4" /> Re-sync
        </button>
        <button onClick={() => setShowAdd(true)} disabled={!empFkey} className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 px-3 py-2 rounded-lg text-sm font-medium">
          <Plus className="w-4 h-4" /> Add Punch
        </button>
      </div>

      {message && <div className="mb-4 text-sm bg-blue-50 text-blue-700 px-3 py-2 rounded-lg">{message}</div>}

      {!empFkey && <p className="text-sm text-gray-400">Select an employee to view punches.</p>}
      {empFkey && isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {empFkey && !isLoading && rows.length === 0 && <p className="text-sm text-gray-400">No punches for this month. Try Sync.</p>}
      {rows.length > 0 && (
        <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="p-2">Log Date/Time</th>
              <th className="p-2">Direction</th>
              <th className="p-2">Shift Date</th>
              <th className="p-2">Move to Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.device_attandance_seq} className="border-t border-gray-100">
                <td className="p-2">{new Date(row.LOGDATE).toLocaleString()}</td>
                <td className="p-2 capitalize">{row.direction}</td>
                <td className="p-2">{row.SHIFTDATE?.slice(0, 10)}</td>
                <td className="p-2">
                  <input
                    type="date"
                    defaultValue={row.SHIFTDATE?.slice(0, 10)}
                    onBlur={(e) => {
                      if (e.target.value && e.target.value !== row.SHIFTDATE?.slice(0, 10)) {
                        editShiftDate.mutate({ id: row.device_attandance_seq, shiftDate: e.target.value });
                      }
                    }}
                    className="border border-gray-300 rounded px-2 py-1 text-sm"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold mb-4">Add Punch</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date</label>
                <input type="date" value={addForm.logDate} onChange={(e) => setAddForm((f) => ({ ...f, logDate: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Time</label>
                <input type="time" step="1" value={addForm.logTime} onChange={(e) => setAddForm((f) => ({ ...f, logTime: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Direction</label>
                <select value={addForm.direction} onChange={(e) => setAddForm((f) => ({ ...f, direction: e.target.value as 'in' | 'out' }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="in">In</option>
                  <option value="out">Out</option>
                </select>
              </div>
            </div>
            <button
              onClick={() => addPunch.mutate()}
              disabled={!addForm.logDate || !addForm.logTime || addPunch.isPending}
              className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium"
            >
              {addPunch.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
