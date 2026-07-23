'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { formatCurrency } from '@/lib/utils';

interface AdvanceRow {
  emp_advance_pkey: number;
  emp_fkey: number;
  emp_name: string;
  advance_amount: number;
  affected_month: string;
  is_credited: string;
  remarks: string | null;
  payment_date: string | null;
}

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function AdvancesPage() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonthYear());
  const [showForm, setShowForm] = useState(false);
  const [empId, setEmpId] = useState('');
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [affectedMonth, setAffectedMonth] = useState('');
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const { data: limitData } = useQuery<{ limit: number }>({
    queryKey: ['advances/limit', empId],
    queryFn: () => fetch(`/api/advances/limit?empFkey=${empId}`).then((r) => r.json()),
    enabled: !!empId,
  });

  const { data, isLoading } = useQuery<{ rows: AdvanceRow[] }>({
    queryKey: ['advances', month],
    queryFn: () => fetch(`/api/advances?month=${month}`).then((r) => r.json()),
  });
  const rows = data?.rows ?? [];

  useEffect(() => { if (!affectedMonth) setAffectedMonth(month); }, [month, affectedMonth]);

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/advances', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empFkey: Number(empId), advanceAmount: Number(advanceAmount), affectedMonth, remarks: remarks || undefined,
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Failed to create advance');
      return b as { id: number; warning?: string };
    },
    onSuccess: (b) => {
      setMessage(b.warning ?? 'Advance saved.');
      setShowForm(false);
      setEmpId(''); setAdvanceAmount(''); setAffectedMonth(''); setRemarks('');
      queryClient.invalidateQueries({ queryKey: ['advances'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => fetch(`/api/advances/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setMessage('Advance removed.');
      queryClient.invalidateQueries({ queryKey: ['advances'] });
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Salary Advances</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Advance
        </button>
      </div>

      {message && <p className="text-sm text-gray-600 mb-4">{message}</p>}

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
          <div className="max-w-sm">
            <label className="block text-xs text-gray-500 mb-1">Employee</label>
            <EmployeeSearch value={empId} onChange={setEmpId} placeholder="Search employee by name or ID" />
            {empId && limitData && (
              <p className="text-xs text-gray-400 mt-1">Suggested limit (80% of monthly gross): {formatCurrency(limitData.limit)}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Advance Amount (₹)</label>
              <input type="number" value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Affected Month</label>
              <input type="month" value={affectedMonth} onChange={(e) => setAffectedMonth(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Remarks</label>
              <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <button
            onClick={() => create.mutate()}
            disabled={!empId || !advanceAmount || !affectedMonth || create.isPending}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {create.isPending ? 'Saving…' : 'Save Advance'}
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 max-w-xs">
        <label className="block text-xs text-gray-500 mb-1">Month</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Affected Month</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Remarks</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No pending advances for this month.</td></tr>
              )}
              {rows.map((row) => (
                <tr key={row.emp_advance_pkey} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800 font-medium">{row.emp_name}</td>
                  <td className="px-4 py-3 text-gray-700">{formatCurrency(row.advance_amount)}</td>
                  <td className="px-4 py-3 text-gray-700">{row.affected_month}</td>
                  <td className="px-4 py-3 text-gray-600">{row.remarks || '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => remove.mutate(row.emp_advance_pkey)} title="Remove" className="text-gray-500 hover:text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
