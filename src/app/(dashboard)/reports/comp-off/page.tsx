'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import { Download, Eye, Loader2, Calendar } from 'lucide-react';
import { CriteriaFilterPanel } from '@/components/reports/CriteriaFilterPanel';
import { exportGroupedReportToExcel, exportGroupedReportToPdf, type ReportColumn, type ReportGroup } from '@/lib/reportExport';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

// Ported from MiscellaniousReportsController::generatecompoffreport_new() — "Comp Off Details
// Report". Legacy's own function only implements the EmployeeDetails criteria (a degraded fallback
// exists for anything else, with no employee/accrued detail — not replicated here, same precedent
// as Monthly Leave). Always rendered as one section per employee (legacy's per-employee header
// block), each section listing that employee's Accrued (worked weekoff/holiday, comp-off eligible)
// and Utilized (comp-off leave actually taken) rows together.
const COLUMNS: ReportColumn[] = [
  { key: 'transaction_type', label: 'Transaction Type' },
  { key: 'transaction_date_display', label: 'Accrued / Utilized Date' },
  { key: 'day', label: 'Day' },
  { key: 'duration', label: 'Duration' },
  { key: 'day_type', label: 'Day Type' },
  { key: 'txn_status', label: 'Status' },
];

function currentMonthRange() {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

function groupRows(rows: Record<string, unknown>[], groupBy: (row: Record<string, unknown>) => string): ReportGroup[] {
  const order: string[] = [];
  const map = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = groupBy(row) || 'Unassigned';
    if (!map.has(key)) { map.set(key, []); order.push(key); }
    map.get(key)!.push(row);
  }
  return order.map((key) => ({ key, rows: map.get(key)! }));
}

function withDerivedColumns(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => ({
    ...r,
    transaction_date_display: r.transaction_date ?? '',
    emp_group_label: `${r.emp_name ?? ''}${r.status === 2 ? ' (Resigned)' : ''} — ${r.employee_id ?? ''}`,
  }));
}

const INPUT_CLASS =
  'h-[42px] border border-[#E5E7EB] bg-white rounded-lg px-2.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'h-[42px] inline-flex items-center gap-1.5 px-4 rounded-lg text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const BTN_SM =
  'h-[38px] inline-flex items-center gap-1.5 px-3 rounded-lg text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function CompOffReportPage() {
  const { slotEl } = useHeaderSlot();
  const [{ from, to }, setRange] = useState(currentMonthRange());
  const [criteria, setCriteria] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const hasCriteria = Object.values(criteria).some((v) => Array.isArray(v) && v.length > 0);
  const resetResults = () => { setRows([]); setError(null); generate.reset(); };
  const displayRows = withDerivedColumns(rows);

  const fetchReportRows = async (): Promise<Record<string, unknown>[]> => {
    const res = await fetch('/api/reports/comp-off', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromDate: from, toDate: to, criteria }),
    });
    const b = await res.json();
    if (!res.ok) throw new Error(b.error ?? 'Failed to generate report');
    return (b.rows ?? []) as Record<string, unknown>[];
  };

  const generate = useMutation({
    mutationFn: fetchReportRows,
    onSuccess: (r) => { setRows(r); setError(null); },
    onError: (err: Error) => setError(err.message),
  });

  const exportReport = useMutation({
    mutationFn: async (kind: 'excel' | 'pdf') => {
      const r = await fetchReportRows();
      const expRows = withDerivedColumns(r);
      const filename = 'Comp Off Details Report';
      const title = `Comp Off Details Report - ${from} to ${to}`;
      const groups = groupRows(expRows, (row) => String(row.emp_group_label ?? ''));
      if (kind === 'excel') exportGroupedReportToExcel(COLUMNS, groups, new Set(), filename, { title, groupTotals: false });
      else exportGroupedReportToPdf(COLUMNS, groups, new Set(), title, filename);
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Comp Off Details Report
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Comp-off days accrued (weekoff/holiday worked) and utilized (leave taken) per employee
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-5 py-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">From</label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input type="date" value={from} onChange={(e) => { setRange({ from: e.target.value, to }); resetResults(); }} className={cn(INPUT_CLASS, 'pl-8')} />
            </div>
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">To</label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input type="date" value={to} onChange={(e) => { setRange({ from, to: e.target.value }); resetResults(); }} className={cn(INPUT_CLASS, 'pl-8')} />
            </div>
          </div>
          <CriteriaFilterPanel
            reportType="Compoff"
            values={criteria}
            onChange={(v) => { setCriteria(v); resetResults(); }}
            allowedCriteria={['EmployeeDetails']}
          />
        </div>
        <div className="flex justify-end items-center gap-2">
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || !from || !to || !hasCriteria}
            title="View Report"
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
          >
            {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
          </button>
          <button
            onClick={() => exportReport.mutate('excel')}
            disabled={exportReport.isPending || !from || !to || !hasCriteria}
            className={cn(BTN_SM, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
          >
            <Download className="w-3.5 h-3.5" /> Excel
          </button>
          <button
            onClick={() => exportReport.mutate('pdf')}
            disabled={exportReport.isPending || !from || !to || !hasCriteria}
            className={cn(BTN_SM, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
          >
            <Download className="w-3.5 h-3.5" /> PDF
          </button>
        </div>
        {error && <p className="text-[12.5px] text-[color:var(--color-danger)]">{error}</p>}
      </div>

      {generate.isSuccess && (
        <h2 className="text-[13px] font-semibold text-[#0F172A] mb-2">Report Results</h2>
      )}

      {displayRows.length === 0 ? (
        <div className="surface-card rounded-xl px-4 py-8 text-center text-[12.5px] text-slate-400">
          {generate.isPending
            ? 'Loading...'
            : generate.isSuccess
              ? 'No records found for the selected criteria.'
              : 'Choose at least one criteria value and click View.'}
        </div>
      ) : (
        <div className="space-y-4">
          {groupRows(displayRows, (row) => String(row.emp_group_label ?? '')).map((group) => (
            <div key={group.key} className="surface-card rounded-2xl overflow-hidden overflow-x-auto">
              <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 text-[13px] font-semibold text-[#0F172A]">{group.key}</div>
              <table className="w-full text-[13px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>{COLUMNS.map((c) => <th key={c.key} className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{c.label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {group.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50/70">
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="px-4 py-2 text-[#0F172A] whitespace-nowrap">{String(row[c.key] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
