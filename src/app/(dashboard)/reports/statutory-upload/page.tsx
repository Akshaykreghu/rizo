'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Download, Play } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface Branch { id: number; branch_code: string; branch_name: string; status: number }

interface EpfContributionRow {
  emp_pkey: number;
  emp_name: string;
  uan: string;
  gross: number;
  epf_wages: number;
  eps_wages: number;
  edli_wages: number;
  epf_contribution: number;
  eps_contribution: number;
  epf_eps_diff: number;
  ncp_days: number;
  refund: number;
}

const COLUMNS: { key: keyof EpfContributionRow; label: string }[] = [
  { key: 'uan', label: 'UAN' }, { key: 'emp_name', label: 'Employee' },
  { key: 'gross', label: 'Gross' }, { key: 'epf_wages', label: 'EPF Wages' },
  { key: 'eps_wages', label: 'EPS Wages' }, { key: 'edli_wages', label: 'EDLI Wages' },
  { key: 'epf_contribution', label: 'EPF Contribution' }, { key: 'eps_contribution', label: 'EPS Contribution' },
  { key: 'epf_eps_diff', label: 'EPF-EPS Diff' }, { key: 'ncp_days', label: 'NCP Days' }, { key: 'refund', label: 'Refund' },
];

const CURRENCY_KEYS = new Set(['gross', 'epf_wages', 'eps_wages', 'edli_wages', 'epf_contribution', 'eps_contribution', 'epf_eps_diff']);

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function toEcrText(rows: EpfContributionRow[]): string {
  return rows
    .map((r) => [r.uan, r.emp_name, r.gross, r.epf_wages, r.eps_wages, r.edli_wages, r.epf_contribution, r.eps_contribution, r.epf_eps_diff, r.ncp_days, r.refund].join('#~#'))
    .join('\r\n') + (rows.length > 0 ? '\r\n' : '');
}

export default function StatutoryUploadPage() {
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [branch, setBranch] = useState('');
  const [rows, setRows] = useState<EpfContributionRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()),
  });

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/reports/statutory-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthYear, branch }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Failed to generate report');
      return (b.rows ?? []) as EpfContributionRow[];
    },
    onSuccess: (r) => { setRows(r); setError(null); },
    onError: (err: Error) => setError(err.message),
  });

  function downloadEcr() {
    const blob = new Blob([toEcrText(rows)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `epfupload_${monthYear}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Statutory Upload</h1>
      <p className="text-sm text-gray-500 mb-6">EPF Contribution — generates the monthly ECR upload file (UAN, wages and contribution figures per employee).</p>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Month</label>
            <input type="month" value={monthYear} onChange={(e) => setMonthYear(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Branch</label>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[180px]">
              <option value="">All Branches</option>
              {(branches ?? []).filter((b) => b.status === 1).map((b) => (
                <option key={b.branch_code} value={b.branch_code}>{b.branch_name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Play className="w-4 h-4" />
            {generate.isPending ? 'Generating…' : 'Generate'}
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {rows.length > 0 && (
          <div className="flex gap-2">
            <button onClick={downloadEcr} className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm text-gray-700">
              <Download className="w-3.5 h-3.5" /> Download ECR File (.txt)
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>{COLUMNS.map((c) => <th key={c.key} className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">{c.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr><td colSpan={COLUMNS.length} className="px-4 py-8 text-center text-gray-400">
                {generate.isPending
                  ? 'Loading...'
                  : generate.isSuccess
                    ? 'No records found for the selected month.'
                    : 'Choose a month and click Generate.'}
              </td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.emp_pkey} className="hover:bg-gray-50">
                {COLUMNS.map((c) => (
                  <td key={c.key} className="px-4 py-3 text-gray-700 whitespace-nowrap">
                    {CURRENCY_KEYS.has(c.key) ? formatCurrency(Number(row[c.key] ?? 0)) : String(row[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
