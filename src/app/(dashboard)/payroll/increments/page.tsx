'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, PlayCircle } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { formatCurrency } from '@/lib/utils';

interface StructureOption { structure_id: number; structure_name: string }
interface HikeRow {
  salary_hike_pkey: number;
  emp_fkey: number;
  emp_name: string;
  with_effect_from: string;
  payout_month: string;
  current_amount: number;
  new_amount: number;
  increment_amount: number;
  increment_percentage: number;
  arrear_salary: string;
  action: string | null;
}

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'processed', label: 'Processed' },
] as const;

export default function IncrementsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('pending');
  const [showForm, setShowForm] = useState(false);
  const [empId, setEmpId] = useState('');
  const [structureId, setStructureId] = useState('');
  const [newGross, setNewGross] = useState('');
  const [withEffectFrom, setWithEffectFrom] = useState('');
  const [nextIncrementDate, setNextIncrementDate] = useState('');
  const [payoutMonth, setPayoutMonth] = useState('');
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const { data: structures = [] } = useQuery<StructureOption[]>({
    queryKey: ['setup/salary-structures'],
    queryFn: () => fetch('/api/setup/salary-structures').then((r) => r.json()),
  });

  const { data, isLoading } = useQuery<{ rows: HikeRow[] }>({
    queryKey: ['payroll/increments', tab],
    queryFn: () => fetch(`/api/payroll/increments?status=${tab}`).then((r) => r.json()),
  });
  const rows = data?.rows ?? [];

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/payroll/increments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empFkey: Number(empId), structureId: Number(structureId), newGross: Number(newGross),
          withEffectFrom, nextIncrementDate, payoutMonth: payoutMonth || undefined, remarks: remarks || undefined,
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Failed to save increment');
      return b;
    },
    onSuccess: () => {
      setMessage('Increment draft saved.');
      setShowForm(false);
      setEmpId(''); setStructureId(''); setNewGross(''); setWithEffectFrom(''); setNextIncrementDate(''); setPayoutMonth(''); setRemarks('');
      queryClient.invalidateQueries({ queryKey: ['payroll/increments'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const process = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/payroll/increments/${id}/process`, { method: 'POST' });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Processing failed');
      return b as { success: boolean; notProcessed: string[]; invalidSalary: string[] };
    },
    onSuccess: (b) => {
      if (b.notProcessed.length || b.invalidSalary.length) {
        setMessage([...b.notProcessed, ...b.invalidSalary].join('; '));
      } else {
        setMessage('Increment processed.');
      }
      queryClient.invalidateQueries({ queryKey: ['payroll/increments'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Salary Increments</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Increment
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
              <label className="block text-xs text-gray-500 mb-1">Salary Structure</label>
              <select
                value={structureId}
                onChange={(e) => setStructureId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select structure</option>
                {structures.map((s) => (
                  <option key={s.structure_id} value={s.structure_id}>{s.structure_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">New Monthly Gross (₹)</label>
              <input type="number" value={newGross} onChange={(e) => setNewGross(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">With Effect From</label>
              <input type="date" value={withEffectFrom} onChange={(e) => setWithEffectFrom(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Next Increment Date</label>
              <input type="date" value={nextIncrementDate} onChange={(e) => setNextIncrementDate(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Payout Month (optional)</label>
              <input type="month" value={payoutMonth} onChange={(e) => setPayoutMonth(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Remarks</label>
              <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <button
            onClick={() => create.mutate()}
            disabled={!empId || !structureId || !newGross || !withEffectFrom || !nextIncrementDate || create.isPending}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {create.isPending ? 'Saving…' : 'Save Draft'}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              tab === t.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Effective</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Current</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">New</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Increment</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Arrear?</th>
                {tab === 'pending' && <th className="text-right px-4 py-3 font-medium text-gray-600">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">No records found.</td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.salary_hike_pkey} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800 font-medium">{row.emp_name}</td>
                  <td className="px-4 py-3 text-gray-700">{new Date(row.with_effect_from).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-gray-700">{formatCurrency(row.current_amount)}</td>
                  <td className="px-4 py-3 text-gray-700">{formatCurrency(row.new_amount)}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {formatCurrency(row.increment_amount)} ({row.increment_percentage.toFixed(1)}%)
                  </td>
                  <td className="px-4 py-3 text-gray-700">{row.arrear_salary === 'Y' ? 'Yes' : 'No'}</td>
                  {tab === 'pending' && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => process.mutate(row.salary_hike_pkey)}
                        disabled={process.isPending}
                        className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                      >
                        <PlayCircle className="w-4 h-4" />
                        Process
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
