'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import { Download, Play } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { CriteriaFilterPanel } from '@/components/reports/CriteriaFilterPanel';
import { exportReportToExcel, exportReportToPdf, type ReportColumn } from '@/lib/reportExport';
import { cn, formatCurrency } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

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

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function LoanAdvanceReportPage() {
  const { slotEl } = useHeaderSlot();
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

  const tableColumns: ColumnDef<Record<string, unknown>, unknown>[] = useMemo(
    () =>
      meta.columns.map((c) => ({
        id: c.key,
        header: c.label,
        accessorFn: (row: Record<string, unknown>) => row[c.key],
        cell: ({ getValue }: { getValue: () => unknown }) => (
          <span className="whitespace-nowrap">
            {c.key === 'is_completed'
              ? (getValue() === 'Y' ? 'Completed' : 'Active')
              : CURRENCY_KEYS.has(c.key) ? formatCurrency(Number(getValue() ?? 0)) : String(getValue() ?? '')}
          </span>
        ),
      })),
    [meta.columns]
  );

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
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Loan / Advance Report
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Employee loan and advance ledgers
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
          {type === 'Loan' ? (
            <>
              <div>
                <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Created From</label>
                <input type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} className={INPUT_CLASS} />
              </div>
              <div>
                <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Created To</label>
                <input type="month" value={toMonth} onChange={(e) => setToMonth(e.target.value)} className={INPUT_CLASS} />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Affected Month</label>
              <input type="month" value={monthYear} onChange={(e) => setMonthYear(e.target.value)} className={INPUT_CLASS} />
            </div>
          )}
          <CriteriaFilterPanel reportType={type} values={criteria} onChange={setCriteria} />
          <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600 pb-1.5">
            <input type="checkbox" checked={includeResigned} onChange={(e) => setIncludeResigned(e.target.checked)} className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40" />
            Include resigned
          </label>
          {type === 'Loan' && (
            <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600 pb-1.5">
              <input type="checkbox" checked={includeCompleted} onChange={(e) => setIncludeCompleted(e.target.checked)} className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40" />
              Include completed loans
            </label>
          )}
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
            <button onClick={() => exportReportToExcel(meta.columns, rows, 'loan_advance_report')} className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}>
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
            <button onClick={() => exportReportToPdf(meta.columns, rows, meta.label, 'loan_advance_report')} className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}>
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
