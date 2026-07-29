'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, Play } from 'lucide-react';
import { CriteriaFilterPanel } from '@/components/reports/CriteriaFilterPanel';
import { exportReportToExcel, exportReportToPdf, type ReportColumn } from '@/lib/reportExport';

type ReportType = 'VerifiedAttendance' | 'DetailedAttendance' | 'OvertimeReport' | 'Overtime' | 'Dashboard' | 'regularisation';

const TYPE_META: Record<ReportType, { label: string; dateRange?: boolean; columns: ReportColumn[] }> = {
  VerifiedAttendance: {
    label: 'Attendance Register',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'presant_total', label: 'Present' }, { key: 'leave_total', label: 'Leave' },
      { key: 'lop_total', label: 'LOP' }, { key: 'holiday_total', label: 'Holidays' },
      { key: 'weekoff_total', label: 'Week Offs' }, { key: 'working_days', label: 'Working Days' },
    ],
  },
  DetailedAttendance: {
    label: 'Detailed Attendance Reports',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'dept_name', label: 'Department' }, { key: 'LOGDATE', label: 'Log Date/Time' },
      { key: 'punch_type', label: 'Punch Type' },
    ],
  },
  OvertimeReport: {
    label: 'Overtime Reports',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'att_date', label: 'Date' }, { key: 'ot_duration', label: 'OT Duration (min)' },
      { key: 'remarks', label: 'Remarks' },
    ],
  },
  Overtime: {
    label: 'Approved Over Time',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'total_duration', label: 'Total Duration (min)' }, { key: 'set_duration', label: 'Approved (min)' },
    ],
  },
  Dashboard: {
    label: 'Employee Check-in/out logs',
    dateRange: true,
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'dept_name', label: 'Department' }, { key: 'LOGDATE', label: 'Log Date/Time' },
      { key: 'status', label: 'Status' }, { key: 'device', label: 'Device' },
    ],
  },
  regularisation: {
    label: 'Attendance Regularisation',
    dateRange: true,
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'att_date', label: 'Date' }, { key: 'direction', label: 'Direction' },
      { key: 'LOGTIME', label: 'Time' }, { key: 'approved', label: 'Status' }, { key: 'remarks', label: 'Remarks' },
    ],
  },
};

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function currentMonthRange() {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export default function AttendanceReportPage() {
  const [type, setType] = useState<ReportType>('VerifiedAttendance');
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [{ from, to }, setRange] = useState(currentMonthRange());
  const [criteria, setCriteria] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const meta = TYPE_META[type];

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/reports/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          monthYear: meta.dateRange ? undefined : monthYear,
          fromDate: meta.dateRange ? from : undefined,
          toDate: meta.dateRange ? to : undefined,
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
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Attendance Report</h1>

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
          {meta.dateRange ? (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input type="date" value={from} onChange={(e) => setRange({ from: e.target.value, to })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input type="date" value={to} onChange={(e) => setRange({ from, to: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Month</label>
              <input type="month" value={monthYear} onChange={(e) => setMonthYear(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
          <CriteriaFilterPanel reportType={type} values={criteria} onChange={setCriteria} />
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
            <button onClick={() => exportReportToExcel(meta.columns, rows, 'attendance_report')} className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm text-gray-700">
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
            <button onClick={() => exportReportToPdf(meta.columns, rows, meta.label, 'attendance_report')} className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm text-gray-700">
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
