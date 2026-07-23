'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface Branch {
  id: number;
  branch_code: string;
  branch_name: string;
}
interface TdsRow {
  emp_fkey: number;
  first_name: string;
  last_name: string | null;
  emp_branch: string;
  taxable_income: number;
  tax_yearly: number;
  tax_monthly_proj: number;
  regime: 'Old' | 'New';
}

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function TdsReportPage() {
  const [branch, setBranch] = useState('');
  const [month, setMonth] = useState(currentMonthYear());

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()),
  });

  const { data, isLoading } = useQuery<{ rows: TdsRow[] }>({
    queryKey: ['reports/tds', branch, month],
    queryFn: () => fetch(`/api/reports/tds?branch=${branch}&month=${month}`).then((r) => r.json()),
    enabled: !!month,
  });
  const rows = data?.rows ?? [];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">TDS Report</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Branch</label>
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[180px]"
          >
            <option value="">All branches</option>
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
            onChange={(e) => setMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <a
          href={`/api/reports/tds/export?branch=${branch}&month=${month}`}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Download className="w-4 h-4" />
          Export Excel
        </a>
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Branch</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Regime</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Taxable Income</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Yearly Tax</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Monthly TDS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">No records for this period.</td>
                </tr>
              )}
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800 font-medium">{row.first_name} {row.last_name ?? ''}</td>
                  <td className="px-4 py-3 text-gray-700">{row.emp_branch}</td>
                  <td className="px-4 py-3 text-gray-700">{row.regime}</td>
                  <td className="px-4 py-3 text-gray-700">{formatCurrency(row.taxable_income)}</td>
                  <td className="px-4 py-3 text-gray-700">{formatCurrency(row.tax_yearly)}</td>
                  <td className="px-4 py-3 text-gray-800 font-medium">{formatCurrency(row.tax_monthly_proj)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
