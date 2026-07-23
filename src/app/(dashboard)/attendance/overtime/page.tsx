'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';

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

interface OtRow {
  empOtMasterPkey: number;
  empFkey: number;
  empName: string;
  totalDurationMin: number;
  setDurationMin: number;
  isVerified: boolean;
}

export default function OvertimePage() {
  const [month, setMonth] = useState(currentMonth());
  const [branch, setBranch] = useState('');
  const [tab, setTab] = useState<'not-approved' | 'approved'>('not-approved');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  const [message, setMessage] = useState<string | null>(null);

  const { data: branches = [] } = useLookup('setup/branches', 'branch_code', (r) => String(r.branch_name));

  const { data, isLoading, refetch } = useQuery<{ data: OtRow[] }>({
    queryKey: ['attendance-overtime', month, branch, tab],
    queryFn: () => fetch(`/api/attendance/overtime?month=${month}&branch=${branch}&tab=${tab}`).then((r) => r.json()),
    enabled: !!branch,
  });

  const rows = data?.data ?? [];

  const approve = useMutation({
    mutationFn: () =>
      fetch('/api/attendance/overtime/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month,
          employees: Array.from(selected).map((empFkey) => ({
            emp_fkey: empFkey,
            set_duration_min: overrides[empFkey],
          })),
        }),
      }).then((r) => r.json()),
    onSuccess: () => {
      setMessage(`Approved ${selected.size} employee(s)`);
      setSelected(new Set());
      refetch();
    },
  });

  const toggle = (empFkey: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(empFkey)) next.delete(empFkey);
      else next.add(empFkey);
      return next;
    });
  };

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Overtime</h1>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Branch</label>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm min-w-[180px]">
            <option value="">Select branch</option>
            {branches.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {tab === 'not-approved' && (
          <button
            onClick={() => approve.mutate()}
            disabled={selected.size === 0 || approve.isPending}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
          >
            <CheckCircle2 className="w-4 h-4" /> Approve Selected
          </button>
        )}
      </div>

      {message && <div className="mb-4 text-sm bg-blue-50 text-blue-700 px-3 py-2 rounded-lg">{message}</div>}

      <div className="flex gap-4 mb-4 border-b border-gray-200">
        <button
          onClick={() => { setTab('not-approved'); setSelected(new Set()); }}
          className={`pb-2 text-sm font-medium ${tab === 'not-approved' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500'}`}
        >
          Not Approved
        </button>
        <button
          onClick={() => { setTab('approved'); setSelected(new Set()); }}
          className={`pb-2 text-sm font-medium ${tab === 'approved' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500'}`}
        >
          Approved
        </button>
      </div>

      {!branch && <p className="text-sm text-gray-400">Select a branch to view overtime.</p>}
      {branch && isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {branch && !isLoading && rows.length === 0 && (
        <p className="text-sm text-gray-400">No records — overtime only appears once attendance for the month is verified.</p>
      )}
      {branch && rows.length > 0 && (
        <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-gray-50 text-left">
              {tab === 'not-approved' && <th className="p-2 w-8" />}
              <th className="p-2">Employee</th>
              <th className="p-2">Total Hrs Worked</th>
              <th className="p-2">OT (hrs)</th>
              {tab === 'not-approved' && <th className="p-2">Set New OT (mins)</th>}
              <th className="p-2">New OT (hrs)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const override = overrides[row.empFkey];
              const mins = override ?? row.totalDurationMin;
              return (
                <tr key={row.empOtMasterPkey} className="border-t border-gray-100">
                  {tab === 'not-approved' && (
                    <td className="p-2">
                      <input type="checkbox" checked={selected.has(row.empFkey)} onChange={() => toggle(row.empFkey)} />
                    </td>
                  )}
                  <td className="p-2">{row.empName}</td>
                  <td className="p-2">{(row.totalDurationMin / 60).toFixed(2)}</td>
                  <td className="p-2">{(row.setDurationMin / 60).toFixed(2)}</td>
                  {tab === 'not-approved' && (
                    <td className="p-2">
                      <input
                        type="number"
                        min={0}
                        max={44640}
                        value={override ?? row.totalDurationMin}
                        onChange={(e) => {
                          const v = Math.min(44640, Math.max(0, Number(e.target.value) || 0));
                          setOverrides((prev) => ({ ...prev, [row.empFkey]: v }));
                        }}
                        className="border border-gray-300 rounded px-2 py-1 w-24 text-sm"
                      />
                    </td>
                  )}
                  <td className="p-2">{(mins / 60).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
