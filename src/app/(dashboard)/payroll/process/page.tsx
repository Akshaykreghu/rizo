'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, PlayCircle, PauseCircle, Undo2, FileText } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface Branch {
  id: number;
  branch_code: string;
  branch_name: string;
}

interface PayrollRow {
  payroll_master_pkey: number;
  emp_fkey: number;
  emp_name: string;
  days_presant: number | null;
  days_leave: number | null;
  loss_of_pay: number | null;
  gross_salary: number | null;
  net_salary: number | null;
  total_deductions: number | null;
  action: string | null;
  resigned: boolean;
}

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'hold', label: 'On Hold' },
] as const;

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function ProcessPayrollPage() {
  const queryClient = useQueryClient();
  const [branch, setBranch] = useState('');
  const [month, setMonth] = useState(currentMonthYear());
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('pending');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [taxInclude, setTaxInclude] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()),
  });

  const { data, isLoading, refetch } = useQuery<{ rows: PayrollRow[] }>({
    queryKey: ['payroll', branch, month, tab],
    queryFn: () => fetch(`/api/payroll?branch=${branch}&month=${month}&status=${tab}`).then((r) => r.json()),
    enabled: !!branch && !!month,
  });
  const rows = data?.rows ?? [];

  function toggle(pkey: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(pkey) ? next.delete(pkey) : next.add(pkey);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.payroll_master_pkey))));
  }

  const seed = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/payroll', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch, month }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Seed failed');
      return b;
    },
    onSuccess: () => { setMessage('Payroll drafts seeded from attendance.'); refetch(); },
    onError: (err: Error) => setMessage(err.message),
  });

  function onBulkSuccess(b: { errors?: { payroll_master_pkey: number; error: string }[] }) {
    setSelected(new Set());
    setMessage(b.errors?.length ? `Done with ${b.errors.length} error(s) — see console.` : 'Done.');
    if (b.errors?.length) console.error('Payroll action errors:', b.errors);
    queryClient.invalidateQueries({ queryKey: ['payroll'] });
  }
  function onBulkError(err: Error) {
    setMessage(err.message);
  }
  async function postAction(path: string, body: Record<string, unknown>) {
    const res = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const b = await res.json();
    if (!res.ok) throw new Error(b.error ?? 'Action failed');
    return b;
  }

  const process = useMutation({
    mutationFn: () => postAction('/api/payroll/process', { ids: Array.from(selected), tax: taxInclude }),
    onSuccess: onBulkSuccess,
    onError: onBulkError,
  });
  const hold = useMutation({
    mutationFn: () => postAction('/api/payroll/hold', { ids: Array.from(selected) }),
    onSuccess: onBulkSuccess,
    onError: onBulkError,
  });
  const reprocess = useMutation({
    mutationFn: () => postAction('/api/payroll/reprocess', { ids: Array.from(selected) }),
    onSuccess: onBulkSuccess,
    onError: onBulkError,
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Process Payroll</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Branch</label>
          <select
            value={branch}
            onChange={(e) => { setBranch(e.target.value); setSelected(new Set()); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[180px]"
          >
            <option value="">Select branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.branch_code}>{b.branch_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => { setMonth(e.target.value); setSelected(new Set()); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={() => seed.mutate()}
          disabled={!branch || !month || seed.isPending}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          {seed.isPending ? 'Seeding…' : 'Seed from Attendance'}
        </button>
        {message && <span className="text-sm text-gray-600">{message}</span>}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSelected(new Set()); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              tab === t.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {branch && month && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={taxInclude} onChange={(e) => setTaxInclude(e.target.checked)} />
            Include TDS in this run
          </label>
          <button
            onClick={() => process.mutate()}
            disabled={!selected.size || process.isPending}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <PlayCircle className="w-4 h-4" />
            {process.isPending ? 'Processing…' : `Process ${selected.size || ''}`}
          </button>
          {tab === 'pending' && (
            <button
              onClick={() => hold.mutate()}
              disabled={!selected.size || hold.isPending}
              className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <PauseCircle className="w-4 h-4" />
              Hold
            </button>
          )}
          {tab === 'hold' && (
            <button
              onClick={() => reprocess.mutate()}
              disabled={!selected.size || reprocess.isPending}
              className="flex items-center gap-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Undo2 className="w-4 h-4" />
              Send back to Pending
            </button>
          )}
        </div>
      )}

      {!branch || !month ? (
        <div className="text-gray-500 text-sm">Select a branch and month to begin.</div>
      ) : isLoading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-3 text-left">
                  <input type="checkbox" checked={!!rows.length && selected.size === rows.length} onChange={toggleAll} />
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Present</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">LOP</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Gross</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Deductions</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Net</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Slip</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                    No records. {tab === 'pending' && 'Try seeding from attendance.'}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.payroll_master_pkey} className="hover:bg-gray-50">
                  <td className="px-3 py-3">
                    <input type="checkbox" checked={selected.has(row.payroll_master_pkey)} onChange={() => toggle(row.payroll_master_pkey)} />
                  </td>
                  <td className="px-4 py-3 text-gray-800 font-medium">
                    {row.emp_name}
                    {row.resigned && <span className="ml-2 text-xs text-red-600">(resigned)</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{row.days_presant ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-700">{row.loss_of_pay ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-700">{row.gross_salary != null ? formatCurrency(row.gross_salary) : '-'}</td>
                  <td className="px-4 py-3 text-gray-700">{row.total_deductions != null ? formatCurrency(row.total_deductions) : '-'}</td>
                  <td className="px-4 py-3 text-gray-800 font-medium">{row.net_salary != null ? formatCurrency(row.net_salary) : '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{row.action || 'Draft'}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/payroll/slip/${row.payroll_master_pkey}`} className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-indigo-600 inline-flex">
                      <FileText className="w-4 h-4" />
                    </Link>
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
