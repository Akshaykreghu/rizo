'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Play } from 'lucide-react';
import { CriteriaFilterPanel } from '@/components/reports/CriteriaFilterPanel';
import { FieldPicker } from '@/components/reports/FieldPicker';
import { exportReportToExcel, exportReportToPdf, toDataTableColumns, type ReportColumn } from '@/lib/reportExport';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

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

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function EmployeeReportPage() {
  const { slotEl } = useHeaderSlot();
  const [subtype, setSubtype] = useState<Subtype>('employeelist');
  const [includeResigned, setIncludeResigned] = useState(false);
  const [criteria, setCriteria] = useState<Record<string, string[]>>({});
  const [fields, setFields] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const meta = SUBTYPE_META[subtype];

  const { data: fieldCatalog } = useQuery<{ fields: { key: string; label: string }[] }>({
    queryKey: ['reports/employee-fields'],
    queryFn: () => fetch('/api/reports/employee-fields').then((r) => r.json()),
    enabled: subtype === 'employeelist',
  });

  // When custom fields are picked, the table columns follow the picker's selection (always led
  // by Employee ID / Name, which the API always includes); otherwise fall back to the subtype's
  // default fixed column set.
  const columns: ReportColumn[] = useMemo(
    () =>
      subtype === 'employeelist' && fields.length > 0
        ? [
            { key: 'employee_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Name' },
            ...fields.map((key) => ({ key, label: fieldCatalog?.fields.find((f) => f.key === key)?.label ?? key })),
          ]
        : meta.columns,
    [subtype, fields, fieldCatalog, meta.columns]
  );

  const tableColumns = useMemo(() => toDataTableColumns(columns), [columns]);

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/reports/employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subtype, includeResigned, criteria,
          fields: subtype === 'employeelist' && fields.length > 0 ? fields : undefined,
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
              Employee Report
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Employee list, salary structure, shift, leave, and holiday assignments
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Report Type</label>
            <select
              value={subtype}
              onChange={(e) => { setSubtype(e.target.value as Subtype); setRows([]); setCriteria({}); setFields([]); setError(null); generate.reset(); }}
              className={cn(INPUT_CLASS, 'min-w-[180px]')}
            >
              {Object.entries(SUBTYPE_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
            </select>
          </div>
          <CriteriaFilterPanel reportType={meta.reportType} values={criteria} onChange={setCriteria} />
          <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600 pb-1.5">
            <input type="checkbox" checked={includeResigned} onChange={(e) => setIncludeResigned(e.target.checked)} className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40" />
            Include resigned
          </label>
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
          >
            <Play className="w-3.5 h-3.5" />
            {generate.isPending ? 'Generating…' : 'Generate'}
          </button>
        </div>

        {subtype === 'employeelist' && (
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Report Fields (optional — leave empty for default columns)</label>
            <FieldPicker selected={fields} onChange={setFields} />
          </div>
        )}

        {error && <p className="text-[12.5px] text-[color:var(--color-danger)]">{error}</p>}
        {rows.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={() => exportReportToExcel(columns, rows, 'employee_report')}
              className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
            >
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
            <button
              onClick={() => exportReportToPdf(columns, rows, 'Employee Report', 'employee_report')}
              className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
            >
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
