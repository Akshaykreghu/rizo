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

// Ported from MiscellaniousReportsController's LeaveSummary branch of generatereport() /
// reportleavesummary.ctp — "Leave Details Reports". Styled to match the Payroll/Leave Balance
// report screens (View/Excel/PDF actions, per-branch sectioned tables with Sl No when the Units
// criteria is selected, flat table otherwise).
const COLUMNS: ReportColumn[] = [
  { key: 'emp_name', label: 'Employee Name' },
  { key: 'employee_id', label: 'Employee ID' },
  { key: 'joining_date', label: 'Date Of Join' },
  { key: 'branch', label: 'Branch' },
  { key: 'department', label: 'Department' },
  { key: 'leave_applied_on', label: 'Applied Date' },
  { key: 'leave_from_display', label: 'From Date' },
  { key: 'leave_to_display', label: 'To Date' },
  { key: 'Reason', label: 'Reason' },
  { key: 'contact_person', label: 'Contact Person' },
  { key: 'Authorized_name', label: 'Authorized By' },
  { key: 'Authorized_remarks', label: 'Authorized Person Remarks' },
  { key: 'Autherized_date', label: 'Authorized Date' },
  { key: 'Approved_name', label: 'Approved By' },
  { key: 'Approved_remarks', label: 'Approved Person Remarks' },
  { key: 'APPROVED_date', label: 'Approved Date' },
  { key: 'Rejected_name', label: 'Rejected By' },
  { key: 'Rejected_remarks', label: 'Rejected Person Remarks' },
  { key: 'Rejected_date', label: 'Rejected Date' },
  { key: 'leave_type', label: 'Leave Type' },
  { key: 'leavedays', label: 'Leave Days' },
  { key: 'leave_status', label: 'Leave Status' },
];

const HALF_LABEL: Record<number, string> = { 1: 'First Half', 2: 'Second Half' };

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

const INPUT_CLASS =
  'h-[42px] border border-[#E5E7EB] bg-white rounded-lg px-2.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'h-[42px] inline-flex items-center gap-1.5 px-4 rounded-lg text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const BTN_SM =
  'h-[38px] inline-flex items-center gap-1.5 px-3 rounded-lg text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

// Mirrors legacy's exact rejecter fallback (reportleavesummary.ctp:136-151): if leave_status is
// Rejected, the "rejecter" is whoever actually acted — the approver if APPROVED_date is set,
// otherwise the authorizer — displayed under separate Rejected By/Remarks/Date columns rather than
// overloading the Approved columns the way legacy's raw template does.
function withDerivedColumns(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const isRejected = r.leave_status === 'Rejected';
    const approvedDate = r.APPROVED_date;
    return {
      ...r,
      leave_from_display: `${r.leave_from ?? ''} ${HALF_LABEL[Number(r.fromhalf)] ?? ''}`.trim(),
      leave_to_display: `${r.leave_to ?? ''} ${HALF_LABEL[Number(r.tohalf)] ?? ''}`.trim(),
      Approved_remarks: isRejected ? '' : r.Approved_remarks,
      APPROVED_date: isRejected ? '' : r.APPROVED_date,
      Rejected_name: isRejected ? (approvedDate ? r.Approved_name : r.Authorized_name) : '',
      Rejected_remarks: isRejected ? (approvedDate ? r.Approved_remarks : r.Authorized_remarks) : '',
      Rejected_date: isRejected ? (approvedDate ? approvedDate : r.Autherized_date) : '',
    };
  });
}

export default function LeaveSummaryReportPage() {
  const { slotEl } = useHeaderSlot();
  const [{ from, to }, setRange] = useState(currentMonthRange());
  const [criteria, setCriteria] = useState<Record<string, string[]>>({});
  const [includeResigned, setIncludeResigned] = useState(false);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const hasCriteria = Object.values(criteria).some((v) => Array.isArray(v) && v.length > 0);
  // Units criteria sections the report by branch (matching legacy's needBranchWiseReport);
  // every other criteria renders one flat table.
  const groupByBranch = !!criteria.Units?.length;

  const resetResults = () => { setRows([]); setError(null); generate.reset(); };

  const displayRows = withDerivedColumns(rows);

  const fetchReportRows = async (): Promise<Record<string, unknown>[]> => {
    const res = await fetch('/api/reports/leave-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromDate: from, toDate: to, includeResigned, criteria }),
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
      const filename = `Leave Detailed Report - ${from} to ${to}`;
      const title = `Employees Leave Detailed Reports - ${from} to ${to}`;
      if (kind === 'excel') {
        if (groupByBranch) {
          exportGroupedReportToExcel(COLUMNS, groupRows(expRows, (row) => String(row.branch ?? '')), new Set(), filename, { title, slNo: true });
        } else {
          exportReportToExcel(COLUMNS, expRows, filename, { title, slNo: true });
        }
      } else {
        if (groupByBranch) {
          exportGroupedReportToPdf(COLUMNS, groupRows(expRows, (row) => String(row.branch ?? '')), new Set(), title, filename);
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
              Leave Detailed Report
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Every leave request in the selected date range, with authorizer/approver detail
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
            reportType="LeaveSummary"
            values={criteria}
            onChange={(v) => { setCriteria(v); resetResults(); }}
            allowedCriteria={['Units', 'EmployeeDetails', 'LeaveType', 'Leavestatus']}
            includeResigned={includeResigned}
            onIncludeResignedChange={(v) => { setIncludeResigned(v); resetResults(); }}
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
      ) : groupByBranch ? (
        <div className="space-y-4">
          {groupRows(displayRows, (row) => String(row.branch ?? '')).map((group) => (
            <div key={group.key} className="surface-card rounded-2xl overflow-hidden overflow-x-auto">
              <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 text-[13px] font-semibold text-[#0F172A]">{group.key} Branch</div>
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
                        <td key={c.key} className="px-4 py-2 text-[#0F172A] whitespace-nowrap">{String(row[c.key] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
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
