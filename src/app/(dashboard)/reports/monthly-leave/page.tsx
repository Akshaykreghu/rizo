'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import { Download, Eye, Loader2, Calendar } from 'lucide-react';
import { CriteriaFilterPanel } from '@/components/reports/CriteriaFilterPanel';
import { exportReportToExcel, exportReportToPdf, type ReportColumn } from '@/lib/reportExport';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

// Ported from MiscellaniousReportsController::generateleavebalancemonthlyreportnew() — "Monthly
// Leave Taken Register". Legacy's own function only implements the EmployeeDetails criteria (no
// Units/branch-wise variant exists in the source), so this report is always a single flat table —
// no per-branch sectioning, unlike Leave Balance/Leave Detailed.
const COLUMNS: ReportColumn[] = [
  { key: 'employee_id', label: 'Employee ID' },
  { key: 'user_id', label: 'User ID' },
  { key: 'emp_name_display', label: 'Employee Name' },
  { key: 'joining_date', label: 'Date of Joining' },
  { key: 'branch_name', label: 'Branch' },
  { key: 'department', label: 'Department' },
  { key: 'designation', label: 'Designation' },
  { key: 'last_approved_working_date', label: 'Termination Date' },
  { key: 'leave_policy_type_label', label: 'Leave Policy Type' },
  { key: 'leave_type', label: 'Leave Type' },
  { key: 'leave_date', label: 'Leave Date' },
  { key: 'applied_date', label: 'Applied Date' },
  { key: 'Autherized_date', label: 'Authorized Date' },
  { key: 'authorized_by_name', label: 'Authorized Person' },
  { key: 'APPROVED_date', label: 'Approved Date' },
  { key: 'approved_by_name', label: 'Approved Person' },
];

const POLICY_TYPE_LABEL: Record<string, string> = {
  M: 'Monthly', Y: 'Yearly', Q: 'Quarterly', H: 'Half Yearly', D: 'Running Days', P: 'Present Days',
};

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(monthYear: string) {
  const [y, m] = monthYear.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function withDerivedColumns(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => ({
    ...r,
    emp_name_display: `${r.emp_name ?? ''}${r.status === 2 ? ' (Resigned)' : ''}`,
    leave_policy_type_label: POLICY_TYPE_LABEL[String(r.leave_policy_type)] ?? '',
  }));
}

const INPUT_CLASS =
  'h-[42px] border border-[#E5E7EB] bg-white rounded-lg px-2.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'h-[42px] inline-flex items-center gap-1.5 px-4 rounded-lg text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const BTN_SM =
  'h-[38px] inline-flex items-center gap-1.5 px-3 rounded-lg text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function MonthlyLeaveReportPage() {
  const { slotEl } = useHeaderSlot();
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [criteria, setCriteria] = useState<Record<string, string[]>>({});
  const [includeResigned, setIncludeResigned] = useState(false);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const hasCriteria = Object.values(criteria).some((v) => Array.isArray(v) && v.length > 0);
  const resetResults = () => { setRows([]); setError(null); generate.reset(); };
  const displayRows = withDerivedColumns(rows);

  const fetchReportRows = async (): Promise<Record<string, unknown>[]> => {
    const res = await fetch('/api/reports/monthly-leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthYear, includeResigned, criteria }),
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
      const filename = `Monthly Leave Taken Register - ${monthLabel(monthYear)}`;
      if (kind === 'excel') exportReportToExcel(COLUMNS, expRows, filename, { title: filename, slNo: true });
      else exportReportToPdf(COLUMNS, expRows, filename, filename, { slNo: true });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Monthly Leave Taken Register
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Every approved leave date taken by an employee in the selected month
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-5 py-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input type="month" value={monthYear} onChange={(e) => { setMonthYear(e.target.value); resetResults(); }} className={cn(INPUT_CLASS, 'pl-8')} />
            </div>
          </div>
          <CriteriaFilterPanel
            reportType="MonthlyLeave"
            values={criteria}
            onChange={(v) => { setCriteria(v); resetResults(); }}
            allowedCriteria={['EmployeeDetails']}
            includeResigned={includeResigned}
            onIncludeResignedChange={(v) => { setIncludeResigned(v); resetResults(); }}
          />
        </div>
        <div className="flex justify-end items-center gap-2">
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || !monthYear || !hasCriteria}
            title="View Report"
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
          >
            {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
          </button>
          <button
            onClick={() => exportReport.mutate('excel')}
            disabled={exportReport.isPending || !monthYear || !hasCriteria}
            className={cn(BTN_SM, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
          >
            <Download className="w-3.5 h-3.5" /> Excel
          </button>
          <button
            onClick={() => exportReport.mutate('pdf')}
            disabled={exportReport.isPending || !monthYear || !hasCriteria}
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
        <div className="surface-card rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Sl No</th>
                {COLUMNS.map((c) => <th key={c.key} className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{c.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayRows.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50/70">
                  <td className="px-4 py-2 text-[#0F172A] whitespace-nowrap">{i + 1}</td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className="px-4 py-2 text-[#0F172A] whitespace-nowrap">{String(row[c.key] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
