'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, Play } from 'lucide-react';
import { CriteriaFilterPanel } from '@/components/reports/CriteriaFilterPanel';
import { exportReportToExcel, exportReportToPdf, type ReportColumn } from '@/lib/reportExport';

type Subtype = 'employeelist' | 'salarystructure' | 'shiftpolicy' | 'leavepolicy' | 'holiday';

const SUBTYPE_META: Record<Subtype, { label: string; reportType: string; columns: ReportColumn[] }> = {
  employeelist: {
    label: 'Employee List', reportType: 'employee',
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Name' },
      { key: 'branch', label: 'Branch' }, { key: 'department', label: 'Department' },
      { key: 'designation', label: 'Designation' }, { key: 'joining_date', label: 'Joining Date' },
      { key: 'grade', label: 'Grade' }, { key: 'mobile_no', label: 'Mobile' },
    ],
  },
  salarystructure: {
    label: 'Salary Structure', reportType: 'salarystructures',
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Name' },
      { key: 'branch', label: 'Branch' }, { key: 'department', label: 'Department' },
      { key: 'designation', label: 'Designation' }, { key: 'structure_name', label: 'Salary Structure' },
    ],
  },
  shiftpolicy: {
    label: 'Shift Policy', reportType: 'shiftpolicy',
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Name' },
      { key: 'branch', label: 'Branch' }, { key: 'department', label: 'Department' },
      { key: 'shift_policy_name', label: 'Shift Policy Group' },
    ],
  },
  leavepolicy: {
    label: 'Leave Policy', reportType: 'leavepolicy',
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Name' },
      { key: 'branch', label: 'Branch' }, { key: 'department', label: 'Department' },
      { key: 'leave_policy_name', label: 'Leave Policy Group' },
    ],
  },
  holiday: {
    label: 'Holiday Group', reportType: 'holiday',
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Name' },
      { key: 'branch', label: 'Branch' }, { key: 'department', label: 'Department' },
      { key: 'holiday_group_name', label: 'Holiday Group' },
    ],
  },
};

export default function EmployeeReportPage() {
  const [subtype, setSubtype] = useState<Subtype>('employeelist');
  const [includeResigned, setIncludeResigned] = useState(false);
  const [criteria, setCriteria] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const meta = SUBTYPE_META[subtype];

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/reports/employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtype, includeResigned, criteria }),
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
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Employee Report</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Report Type</label>
            <select
              value={subtype}
              onChange={(e) => { setSubtype(e.target.value as Subtype); setRows([]); setCriteria({}); setError(null); generate.reset(); }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[180px]"
            >
              {Object.entries(SUBTYPE_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
            </select>
          </div>
          <CriteriaFilterPanel reportType={meta.reportType} values={criteria} onChange={setCriteria} />
          <label className="flex items-center gap-2 text-sm text-gray-600 pb-2">
            <input type="checkbox" checked={includeResigned} onChange={(e) => setIncludeResigned(e.target.checked)} />
            Include resigned
          </label>
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
            <button
              onClick={() => exportReportToExcel(meta.columns, rows, 'employee_report')}
              className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm text-gray-700"
            >
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
            <button
              onClick={() => exportReportToPdf(meta.columns, rows, 'Employee Report', 'employee_report')}
              className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm text-gray-700"
            >
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
                {meta.columns.map((c) => <td key={c.key} className="px-4 py-3 text-gray-700 whitespace-nowrap">{String(row[c.key] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
