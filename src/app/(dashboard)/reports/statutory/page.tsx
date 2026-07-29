'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, Play } from 'lucide-react';
import { CriteriaFilterPanel } from '@/components/reports/CriteriaFilterPanel';
import { exportReportToExcel, exportReportToPdf, type ReportColumn } from '@/lib/reportExport';
import { formatCurrency } from '@/lib/utils';

type ReportType = 'EPF' | 'ESI' | 'ProfTax' | 'wage' | 'Musterroll';

const CURRENCY_KEYS = new Set(['employee_contribution', 'employer_contribution', 'professional_tax', 'salary_amount']);

const MUSTERROLL_DAY_COLUMNS: ReportColumn[] = Array.from({ length: 31 }, (_, i) => ({ key: `FIELD${i + 1}`, label: `Day ${i + 1}` }));

const TYPE_META: Record<ReportType, { label: string; monthRange?: boolean; hasResigned?: boolean; columns: ReportColumn[] }> = {
  EPF: {
    label: 'EPF Report',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'employee_contribution', label: 'Employee Contribution' }, { key: 'employer_contribution', label: 'Employer Contribution' },
    ],
  },
  ESI: {
    label: 'ESI Report',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'employee_contribution', label: 'Employee Contribution' }, { key: 'employer_contribution', label: 'Employer Contribution' },
    ],
  },
  ProfTax: {
    label: 'Professional Tax Summary',
    monthRange: true,
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'month_year', label: 'Month' }, { key: 'professional_tax', label: 'Professional Tax' },
    ],
  },
  wage: {
    label: 'Wage Sheet',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'salary_head', label: 'Salary Head' }, { key: 'salary_amount', label: 'Amount' },
    ],
  },
  Musterroll: {
    label: 'Muster Roll',
    hasResigned: true,
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'guardian_name', label: 'Guardian' },
      { key: 'branch_name', label: 'Branch' }, { key: 'department', label: 'Department' },
      { key: 'designation', label: 'Designation' }, { key: 'joining_date', label: 'Joining Date' },
      { key: 'termination_date', label: 'Termination Date' },
      { key: 'presant_total', label: 'Present' }, { key: 'leave_total', label: 'Leave' },
      { key: 'weekoff_total', label: 'Week Off' }, { key: 'holiday_total', label: 'Holidays' },
      { key: 'lop_total', label: 'Non-Paying Days' },
      ...MUSTERROLL_DAY_COLUMNS,
    ],
  },
};

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function StatutoryReportPage() {
  const [type, setType] = useState<ReportType>('EPF');
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [fromMonth, setFromMonth] = useState(currentMonthYear());
  const [toMonth, setToMonth] = useState(currentMonthYear());
  const [criteria, setCriteria] = useState<Record<string, string[]>>({});
  const [includeResigned, setIncludeResigned] = useState(false);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const meta = TYPE_META[type];

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/reports/statutory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          monthYear: meta.monthRange ? undefined : monthYear,
          fromMonth: meta.monthRange ? fromMonth : undefined,
          toMonth: meta.monthRange ? toMonth : undefined,
          criteria,
          includeResigned,
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
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Statutory Report</h1>

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
          {meta.monthRange ? (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">From Month</label>
                <input type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To Month</label>
                <input type="month" value={toMonth} onChange={(e) => setToMonth(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Month</label>
              <input type="month" value={monthYear} onChange={(e) => setMonthYear(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
          <CriteriaFilterPanel reportType={type} values={criteria} onChange={setCriteria} />
          {meta.hasResigned && (
            <label className="flex items-center gap-2 text-sm text-gray-600 pb-2">
              <input type="checkbox" checked={includeResigned} onChange={(e) => setIncludeResigned(e.target.checked)} />
              Include resigned
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
            <button onClick={() => exportReportToExcel(meta.columns, rows, 'statutory_report')} className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm text-gray-700">
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
            <button onClick={() => exportReportToPdf(meta.columns, rows, meta.label, 'statutory_report')} className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm text-gray-700">
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
