'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import { Download, Play } from 'lucide-react';
import { CriteriaFilterPanel } from '@/components/reports/CriteriaFilterPanel';
import { exportReportToExcel, exportReportToPdf, toDataTableColumns, type ReportColumn } from '@/lib/reportExport';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

type ReportType = 'VerifiedAttendance' | 'DetailedAttendance' | 'OvertimeReport' | 'Overtime' | 'Dashboard' | 'regularisation' | 'NonPunched';

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
  NonPunched: {
    label: 'Non-Punched Report',
    dateRange: true,
    columns: [
      { key: 'emp_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Employee' },
      { key: 'branch_name', label: 'Branch' }, { key: 'dept_name', label: 'Department' },
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

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function AttendanceReportPage() {
  const { slotEl } = useHeaderSlot();
  const [type, setType] = useState<ReportType>('VerifiedAttendance');
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [{ from, to }, setRange] = useState(currentMonthRange());
  const [criteria, setCriteria] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const meta = TYPE_META[type];
  const tableColumns = useMemo(() => toDataTableColumns(meta.columns), [meta.columns]);

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
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Attendance Report
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Register, detailed logs, overtime, and regularisation reports
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Report Type</label>
            <select
              value={type}
              onChange={(e) => { setType(e.target.value as ReportType); setRows([]); setCriteria({}); setError(null); generate.reset(); }}
              className={cn(INPUT_CLASS, 'min-w-[200px]')}
            >
              {Object.entries(TYPE_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
            </select>
          </div>
          {meta.dateRange ? (
            <>
              <div>
                <label className="block text-[11.5px] font-medium text-slate-500 mb-1">From</label>
                <input type="date" value={from} onChange={(e) => setRange({ from: e.target.value, to })} className={INPUT_CLASS} />
              </div>
              <div>
                <label className="block text-[11.5px] font-medium text-slate-500 mb-1">To</label>
                <input type="date" value={to} onChange={(e) => setRange({ from, to: e.target.value })} className={INPUT_CLASS} />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
              <input type="month" value={monthYear} onChange={(e) => setMonthYear(e.target.value)} className={INPUT_CLASS} />
            </div>
          )}
          <CriteriaFilterPanel reportType={type} values={criteria} onChange={setCriteria} />
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
          >
            <Play className="w-3.5 h-3.5" />
            {generate.isPending ? 'Generating…' : 'Generate'}
          </button>
        </div>
        {error && <p className="text-[12.5px] text-[color:var(--color-danger)]">{error}</p>}
        {rows.length > 0 && (
          <div className="flex gap-2">
            <button onClick={() => exportReportToExcel(meta.columns, rows, 'attendance_report')} className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}>
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
            <button onClick={() => exportReportToPdf(meta.columns, rows, meta.label, 'attendance_report')} className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}>
              <Download className="w-3.5 h-3.5" /> PDF
            </button>
          </div>
        )}
      </div>

      <DataTable
        data={rows}
        columns={tableColumns}
        pageSize={10}
        pageSizeOptions={[10, 20, 30, 50]}
        isLoading={generate.isPending}
      />
    </div>
  );
}
