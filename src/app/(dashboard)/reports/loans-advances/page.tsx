'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, Play } from 'lucide-react';
import { CriteriaFilterPanel } from '@/components/reports/CriteriaFilterPanel';
import { exportReportToExcel, exportReportToPdf, type ReportColumn } from '@/lib/reportExport';
import { formatCurrency } from '@/lib/utils';

type ReportType = 'Loan' | 'Advance';

const CURRENCY_KEYS = new Set(['loan_amount', 'emi_amount', 'paid', 'balance_amount', 'advance_amount']);

const TYPE_META: Record<ReportType, { label: string; columns: ReportColumn[] }> = {
  Loan: {
    label: 'Employee Loan Report',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch', label: 'Branch' },
      { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' },
      { key: 'loan_amount', label: 'Loan Amount' }, { key: 'tenure', label: 'Tenure (mo)' },
      { key: 'intrest_rate', label: 'Interest %' }, { key: 'emi_amount', label: 'EMI' },
      { key: 'emi_start_month', label: 'EMI Start' }, { key: 'emi_end_month', label: 'EMI End' },
      { key: 'paid', label: 'Paid' }, { key: 'balance_amount', label: 'Balance' },
      { key: 'is_completed', label: 'Status' },
    ],
  },
  Advance: {
    label: 'Employee Advance Report',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch', label: 'Branch' },
      { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' },
      { key: 'advance_amount', label: 'Advance Amount' }, { key: 'affected_month', label: 'Affected Month' },
      { key: 'remarks', label: 'Remarks' },
    ],
  },
};

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function LoanAdvanceReportPage() {
  const [type, setType] = useState<ReportType>('Loan');
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [fromMonth, setFromMonth] = useState(currentMonthYear());
  const [toMonth, setToMonth] = useState(currentMonthYear());
  const [includeResigned, setIncludeResigned] = useState(false);
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [criteria, setCriteria] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const meta = TYPE_META[type];

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/reports/loans-advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          monthYear: type === 'Advance' ? monthYear : undefined,
          fromMonth: type === 'Loan' ? fromMonth : undefined,
          toMonth: type === 'Loan' ? toMonth : undefined,
          includeResigned,
          includeCompleted: type === 'Loan' ? includeCompleted : undefined,
          criteria,
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Failed to generate report');
      return (b.rows ?? []) as Record<string, unknown>[];
    },
    onSuccess: (r) => { setRows(r); setError(null); },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Loan / Advance Report</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Report Type</label>
            <select
              value={type}
              onChange={(e) => { setType(e.target.value as ReportType); setRows([]); setCriteria({}); setError(null); generate.reset(); }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[200px]"
            >
              {Object.entries(TYPE_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
            </select>
          </div>
          {type === 'Loan' ? (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Created From</label>
                <input type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Created To</label>
                <input type="month" value={toMonth} onChange={(e) => setToMonth(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Affected Month</label>
              <input type="month" value={monthYear} onChange={(e) => setMonthYear(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
          <CriteriaFilterPanel reportType={type} values={criteria} onChange={setCriteria} />
          <label className="flex items-center gap-2 text-sm text-gray-600 pb-2">
            <input type="checkbox" checked={includeResigned} onChange={(e) => setIncludeResigned(e.target.checked)} />
            Include resigned
          </label>
          {type === 'Loan' && (
            <label className="flex items-center gap-2 text-sm text-gray-600 pb-2">
              <input type="checkbox" checked={includeCompleted} onChange={(e) => setIncludeCompleted(e.target.checked)} />
              Include completed loans
            </label>
          )}
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
            <button onClick={() => exportReportToExcel(meta.columns, rows, 'loan_advance_report')} className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm text-gray-700">
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
            <button onClick={() => exportReportToPdf(meta.columns, rows, meta.label, 'loan_advance_report')} className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm text-gray-700">
              <Download className="w-3.5 h-3.5" /> PDF
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>{meta.columns.map((c) => <th key={c.key} className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">{c.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr><td colSpan={meta.columns.length} className="px-4 py-8 text-center text-gray-400">
                {generate.isPending
                  ? 'Loading...'
                  : generate.isSuccess
                    ? 'No records found for the selected criteria.'
                    : 'Choose at least one criteria value and click Generate.'}
              </td></tr>
            )}
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50">
                {meta.columns.map((c) => (
                  <td key={c.key} className="px-4 py-3 text-gray-700 whitespace-nowrap">
                    {c.key === 'is_completed'
                      ? (row[c.key] === 'Y' ? 'Completed' : 'Active')
                      : CURRENCY_KEYS.has(c.key) ? formatCurrency(Number(row[c.key] ?? 0)) : String(row[c.key] ?? '')}
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
