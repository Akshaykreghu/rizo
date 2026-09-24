'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import { Download, Eye, Loader2, Calendar } from 'lucide-react';
import { CriteriaFilterPanel } from '@/components/reports/CriteriaFilterPanel';
import {
  exportReportToExcel, exportReportToPdf, exportGroupedReportToExcel, exportGroupedReportToPdf,
  type ReportColumn, type ReportGroup,
} from '@/lib/reportExport';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

// Ported from MiscellaniousReportsController::generateleavebalancereportnew() /
// reportleavebalancenew.ctp, styled to match the Payroll Report screen's conventions (View/Excel/
// PDF actions, per-branch sectioned tables with a Total footer row, Sl No numbering). Scope note:
// only the EmployeeDetails and Units (branch) criteria dimensions are supported — see
// src/lib/leaveBalanceReport.ts header comment for why the LeaveType/Departments branches were
// left out of this port.
const COLUMNS: ReportColumn[] = [
  { key: 'emp_name', label: 'Employee Name' },
  { key: 'employee_id', label: 'Employee ID' },
  { key: 'joining_date', label: 'Date Of Joining' },
  { key: 'branch', label: 'Branch' },
  { key: 'designation', label: 'Designation' },
  { key: 'department', label: 'Department' },
  { key: 'leave_type', label: 'Leave Type' },
  { key: 'leave_policy_label', label: 'Leave Policy' },
  { key: 'alloted_leave_forthe_year', label: 'Allotted Leave For The Year' },
  { key: 'carryforwarded', label: 'Carry Forwarded' },
  { key: 'leavetaken', label: 'Leave Taken' },
  { key: 'leavebalance', label: 'Leave Balance (End Of Period)' },
  { key: 'yearlybalance', label: 'Yearly Balance' },
];

const CURRENCY_KEYS = new Set(['alloted_leave_forthe_year', 'carryforwarded', 'leavetaken', 'leavebalance', 'yearlybalance']);

const POLICY_TYPE_LABEL: Record<string, string> = { Y: 'Yearly', M: 'Monthly' };

function currentMonthFirst() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthLabel(asOfDate: string) {
  const [y, m] = asOfDate.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
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

function sumColumn(rows: Record<string, unknown>[], key: string): number {
  return rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
}

const INPUT_CLASS =
  'h-[42px] border border-[#E5E7EB] bg-white rounded-lg px-2.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'h-[42px] inline-flex items-center gap-1.5 px-4 rounded-lg text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const BTN_SM =
  'h-[38px] inline-flex items-center gap-1.5 px-3 rounded-lg text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function LeaveBalanceReportPage() {
  const { slotEl } = useHeaderSlot();
  const [asOfDate, setAsOfDate] = useState(currentMonthFirst());
  const [criteria, setCriteria] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const hasCriteria = Object.values(criteria).some((v) => Array.isArray(v) && v.length > 0);
  // Units criteria sections the report by branch (matching legacy's needBranchWiseReport /
  // $cr == 'Units' template branch); EmployeeDetails renders one flat table.
  const groupByBranch = !!criteria.Units?.length;

  // Any filter change invalidates the currently displayed View results.
  const resetResults = () => { setRows([]); setError(null); generate.reset(); };

  const displayRows: Record<string, unknown>[] = rows.map((r) => ({
    ...r,
    leave_policy_label: POLICY_TYPE_LABEL[String(r.leave_policy_type)] ?? 'Present Days',
  }));

  const fetchReportRows = async (): Promise<Record<string, unknown>[]> => {
    const res = await fetch('/api/reports/leave-balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asOfDate, criteria }),
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
      const expRows: Record<string, unknown>[] = r.map((row) => ({
        ...row,
        leave_policy_label: POLICY_TYPE_LABEL[String(row.leave_policy_type)] ?? 'Present Days',
      }));
      const filename = `Leave Balance Report - ${monthLabel(asOfDate)}`;
      const title = `Employees Leave Balance Report - ${monthLabel(asOfDate)}`;
      if (kind === 'excel') {
        if (groupByBranch) {
          exportGroupedReportToExcel(COLUMNS, groupRows(expRows, (row) => String(row.branch ?? '')), CURRENCY_KEYS, filename, { title, slNo: true });
        } else {
          exportReportToExcel(COLUMNS, expRows, filename, { title, slNo: true });
        }
      } else {
        if (groupByBranch) {
          exportGroupedReportToPdf(COLUMNS, groupRows(expRows, (row) => String(row.branch ?? '')), CURRENCY_KEYS, title, filename);
        } else {
          exportReportToPdf(COLUMNS, expRows, title, filename, { slNo: true });
        }
      }
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Leave Balance Report
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Allotted, carry-forwarded, taken, and available leave balance per employee
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-5 py-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">As of Month</label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="month"
                value={asOfDate.slice(0, 7)}
                onChange={(e) => { setAsOfDate(`${e.target.value}-01`); resetResults(); }}
                className={cn(INPUT_CLASS, 'pl-8')}
              />
            </div>
          </div>
          <CriteriaFilterPanel
            reportType="LeaveBalance"
            values={criteria}
            onChange={(v) => { setCriteria(v); resetResults(); }}
            allowedCriteria={['Units', 'EmployeeDetails']}
          />
        </div>
        <div className="flex justify-end items-center gap-2">
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || !asOfDate || !hasCriteria}
            title="View Report"
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
          >
            {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
          </button>
          <button
            onClick={() => exportReport.mutate('excel')}
            disabled={exportReport.isPending || !asOfDate || !hasCriteria}
            className={cn(BTN_SM, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
          >
            <Download className="w-3.5 h-3.5" /> Excel
          </button>
          <button
            onClick={() => exportReport.mutate('pdf')}
            disabled={exportReport.isPending || !asOfDate || !hasCriteria}
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
      ) : groupByBranch ? (
        <div className="space-y-4">
          {groupRows(displayRows, (row) => String(row.branch ?? '')).map((group) => (
            <div key={group.key} className="surface-card rounded-2xl overflow-hidden overflow-x-auto">
              <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 text-[13px] font-semibold text-[#0F172A]">{group.key}</div>
              <table className="w-full text-[13px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Sl No</th>
                    {COLUMNS.map((c) => <th key={c.key} className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {group.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2 text-[#0F172A] whitespace-nowrap">{i + 1}</td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="px-4 py-2 text-[#0F172A] whitespace-nowrap">
                          {String(row[c.key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-medium">
                  <tr>
                    <td className="px-4 py-2 text-[#0F172A] whitespace-nowrap">Total</td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="px-4 py-2 text-[#0F172A] whitespace-nowrap">
                        {CURRENCY_KEYS.has(c.key) ? sumColumn(group.rows, c.key) : ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}
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
                    <td key={c.key} className="px-4 py-2 text-[#0F172A] whitespace-nowrap">
                      {String(row[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-medium">
              <tr>
                <td className="px-4 py-2 text-[#0F172A] whitespace-nowrap">Total</td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="px-4 py-2 text-[#0F172A] whitespace-nowrap">
                    {CURRENCY_KEYS.has(c.key) ? sumColumn(displayRows, c.key) : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
