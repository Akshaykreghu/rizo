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

// Ports MiscellaniousReportsController's four leave report types (LeaveSummary, LeaveBalance,
// MonthlyLeave, Compoff) into ONE tile with a Report Type dropdown — matching the structure of the
// Payroll Report screen (SUBTYPE_META-driven single page) rather than one separate nav entry/page
// per report type. Each subtype keeps its own backend route (built earlier as separate reports),
// this page just unifies the UI shell around them.

type Subtype = 'LeaveSummary' | 'LeaveBalance' | 'MonthlyLeave' | 'Compoff';

const POLICY_TYPE_LABEL: Record<string, string> = { Y: 'Yearly', M: 'Monthly', Q: 'Quarterly', H: 'Half Yearly', D: 'Running Days', P: 'Present Days' };
const HALF_LABEL: Record<number, string> = { 1: 'First Half', 2: 'Second Half' };

interface SubtypeMeta {
  label: string;
  endpoint: string;
  columns: ReportColumn[];
  // Mirrors showreportnew.ctp's per-type date field exactly: LeaveSummary/Compoff use a From/To
  // date-range picker (capped at 60 days apart — see validateDateRange() in that .ctp);
  // LeaveBalance uses a single "Select Date" date picker (not a month); MonthlyLeave uses a single
  // Month dropdown.
  dateMode: 'range' | 'month' | 'date';
  maxRangeDays?: number;
  allowedCriteria: string[];
  hasResignedFilter?: boolean;
  currencyKeys?: Set<string>;
  // Units criteria sections the on-screen table by branch (matching legacy's needBranchWiseReport);
  // every subtype here uses the same rule except Compoff, which always groups by employee.
  groupBy?: (criteria: Record<string, string[]>) => ((row: Record<string, unknown>) => string) | undefined;
  deriveRows?: (rows: Record<string, unknown>[]) => Record<string, unknown>[];
  slNo?: boolean;
  groupTotals?: boolean;
}

function unitsGroupBy(criteria: Record<string, string[]>) {
  return criteria.Units?.length ? (row: Record<string, unknown>) => String(row.branch ?? '') : undefined;
}

// Mirrors legacy's exact rejecter fallback (reportleavesummary.ctp:136-151): if leave_status is
// Rejected, the "rejecter" is whoever actually acted — the approver if APPROVED_date is set,
// otherwise the authorizer — displayed under separate Rejected By/Remarks/Date columns.
function deriveLeaveSummary(rows: Record<string, unknown>[]): Record<string, unknown>[] {
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

function deriveLeaveBalance(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => ({
    ...r,
    leave_policy_label: POLICY_TYPE_LABEL[String(r.leave_policy_type)] ?? 'Present Days',
    // Legacy's screen view (reportleavebalancenew.ctp) renders the same `leavebalance` value under
    // two separate headers — "Eligibility For Selected Date" (a misleading label; it's not a date,
    // just the balance already zeroed out for an employee not yet eligible as of the selected date)
    // and "Leave Balance (End Of Period)" — so both columns read the identical number.
    eligibility_balance: r.leavebalance,
  }));
}

function deriveMonthlyLeave(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => ({
    ...r,
    emp_name_display: `${r.emp_name ?? ''}${r.status === 2 ? ' (Resigned)' : ''}`,
    leave_policy_type_label: POLICY_TYPE_LABEL[String(r.leave_policy_type)] ?? '',
  }));
}

// Mirrors compoff_new.ctp's per-employee header ("Employee Name : X   Leave Policy Type : Y") and
// per-row column set — every Accrued/Utilized row repeats the employee's own detail columns rather
// than only showing them once in the group header.
function toDMY(value: unknown): string {
  if (!value) return '';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

// Table-cell display: several columns across these reports (joining_date, leave_applied_on,
// Autherized_date, APPROVED_date, Rejected_date, transaction_date, etc.) come back from the API as
// raw ISO datetime strings (e.g. mysql2 serializing a DATE/DATETIME column via JSON.stringify) --
// format any such value as DD-MM-YYYY instead of showing the full "2021-01-01T00:00:00.000Z".
// Values that already went through a *_display/*_label derive step, or aren't date-shaped at all
// (names, remarks, statuses), pass through untouched.
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
function formatCellValue(value: unknown): string {
  if (value == null || value === '') return '';
  const s = String(value);
  if (ISO_DATETIME_RE.test(s)) return toDMY(s);
  return s;
}

function deriveCompOff(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const policyLabel = POLICY_TYPE_LABEL[String(r.leave_policy_type)] ?? '';
    const empDisplay = `${r.emp_name ?? ''}${r.status === 2 ? ' (Resigned)' : ''}`;
    return {
      ...r,
      transaction_date_display: toDMY(r.transaction_date),
      joining_date_display: toDMY(r.joining_date),
      emp_group_label: `Employee Name : ${empDisplay}   Leave Policy Type : ${policyLabel}`,
    };
  });
}

const SUBTYPE_META: Record<Subtype, SubtypeMeta> = {
  LeaveSummary: {
    label: 'Leave Detailed Report',
    endpoint: '/api/reports/leave-summary',
    dateMode: 'range',
    maxRangeDays: 60,
    allowedCriteria: ['Units', 'EmployeeDetails', 'LeaveType', 'Leavestatus'],
    hasResignedFilter: true,
    groupBy: unitsGroupBy,
    deriveRows: deriveLeaveSummary,
    slNo: true,
    columns: [
      { key: 'emp_name', label: 'Employee Name' }, { key: 'employee_id', label: 'Employee ID' },
      { key: 'joining_date', label: 'Date Of Join' }, { key: 'branch', label: 'Branch' }, { key: 'department', label: 'Department' },
      { key: 'leave_applied_on', label: 'Applied Date' }, { key: 'leave_from_display', label: 'From Date' }, { key: 'leave_to_display', label: 'To Date' },
      { key: 'Reason', label: 'Reason' }, { key: 'contact_person', label: 'Contact Person' },
      { key: 'Authorized_name', label: 'Authorized By' }, { key: 'Authorized_remarks', label: 'Authorized Person Remarks' }, { key: 'Autherized_date', label: 'Authorized Date' },
      { key: 'Approved_name', label: 'Approved By' }, { key: 'Approved_remarks', label: 'Approved Person Remarks' }, { key: 'APPROVED_date', label: 'Approved Date' },
      { key: 'Rejected_name', label: 'Rejected By' }, { key: 'Rejected_remarks', label: 'Rejected Person Remarks' }, { key: 'Rejected_date', label: 'Rejected Date' },
      { key: 'leave_type', label: 'Leave Type' }, { key: 'leavedays', label: 'Leave Days' }, { key: 'leave_status', label: 'Leave Status' },
    ],
  },
  LeaveBalance: {
    label: 'Leave Balance Report',
    endpoint: '/api/reports/leave-balance',
    dateMode: 'date',
    allowedCriteria: ['Units', 'EmployeeDetails'],
    groupBy: unitsGroupBy,
    deriveRows: deriveLeaveBalance,
    slNo: true,
    currencyKeys: new Set(['alloted_leave_forthe_year', 'carryforwarded', 'leavetaken', 'encashed_leave', 'eligibility_balance', 'leavebalance']),
    columns: [
      { key: 'emp_name', label: 'Employee Name' }, { key: 'employee_id', label: 'Employee ID' },
      { key: 'joining_date', label: 'Date Of Joining' }, { key: 'branch', label: 'Branch' },
      { key: 'designation', label: 'Designation' }, { key: 'department', label: 'Department' },
      { key: 'leave_type', label: 'Leave Type' }, { key: 'leave_policy_label', label: 'Leave Policy' },
      { key: 'alloted_leave_forthe_year', label: 'Allotted Leave For The Year' }, { key: 'carryforwarded', label: 'Carry Forwarded' },
      { key: 'leavetaken', label: 'Leave Taken' }, { key: 'encashed_leave', label: 'Encashed Leaves' },
      { key: 'eligibility_balance', label: 'Eligibility For Selected Date' },
      { key: 'leavebalance', label: 'Leave Balance (End Of Period)' },
    ],
  },
  MonthlyLeave: {
    label: 'Monthly Leave Taken Register',
    endpoint: '/api/reports/monthly-leave',
    dateMode: 'month',
    allowedCriteria: ['EmployeeDetails'],
    hasResignedFilter: true,
    deriveRows: deriveMonthlyLeave,
    slNo: true,
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'user_id', label: 'User ID' }, { key: 'emp_name_display', label: 'Employee Name' },
      { key: 'joining_date', label: 'Date of Joining' }, { key: 'branch_name', label: 'Branch' }, { key: 'department', label: 'Department' },
      { key: 'designation', label: 'Designation' }, { key: 'last_approved_working_date', label: 'Termination Date' },
      { key: 'leave_policy_type_label', label: 'Leave Policy Type' }, { key: 'leave_type', label: 'Leave Type' },
      { key: 'leave_date', label: 'Leave Date' }, { key: 'applied_date', label: 'Applied Date' },
      { key: 'Autherized_date', label: 'Authorized Date' }, { key: 'authorized_by_name', label: 'Authorized Person' },
      { key: 'APPROVED_date', label: 'Approved Date' }, { key: 'approved_by_name', label: 'Approved Person' },
    ],
  },
  Compoff: {
    label: 'Compensatory Off Details Report',
    endpoint: '/api/reports/comp-off',
    dateMode: 'range',
    maxRangeDays: 60,
    allowedCriteria: ['EmployeeDetails'],
    groupBy: () => (row: Record<string, unknown>) => String(row.emp_group_label ?? ''),
    deriveRows: deriveCompOff,
    groupTotals: false,
    columns: [
      { key: 'emp_name', label: 'Employee Name' }, { key: 'employee_id', label: 'Employee ID' },
      { key: 'joining_date_display', label: 'Date Of Join' }, { key: 'branch', label: 'Branch' },
      { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' },
      { key: 'transaction_type', label: 'Transaction Type' }, { key: 'transaction_date_display', label: 'Accrued / Utilized Date' },
      { key: 'day', label: 'Day' }, { key: 'duration', label: 'Duration' }, { key: 'day_type', label: 'Day Type' }, { key: 'txn_status', label: 'Status' },
    ],
  },
};

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function currentMonthRange() {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}
// Mirrors validateDateRange() in showreportnew.ctp — inclusive day-count between From and To.
function dayDiffInclusive(from: string, to: string): number {
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / oneDay) + 1;
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

export default function LeaveReportPage() {
  const { slotEl } = useHeaderSlot();
  const [subtype, setSubtype] = useState<Subtype>('LeaveSummary');
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [asOfDate, setAsOfDate] = useState(today());
  const [{ from, to }, setRange] = useState(currentMonthRange());
  const [criteria, setCriteria] = useState<Record<string, string[]>>({});
  const [includeResigned, setIncludeResigned] = useState(false);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const meta = SUBTYPE_META[subtype];
  const hasCriteria = Object.values(criteria).some((v) => Array.isArray(v) && v.length > 0);
  const resetResults = () => { setRows([]); setError(null); generate.reset(); };
  const displayRows = meta.deriveRows ? meta.deriveRows(rows) : rows;
  const groupBy = meta.groupBy?.(criteria);
  const currencyKeys = meta.currencyKeys ?? new Set<string>();
  // Mirrors criteriaChanged() in showreportnew.ctp — the View button is hidden entirely when the
  // "belonging to a Leave Status" criteria is selected (that criteria is Excel/PDF-download-only).
  const viewHidden = criteria.Leavestatus?.length ? true : false;
  const rangeTooLong = meta.dateMode === 'range' && meta.maxRangeDays && from && to
    ? dayDiffInclusive(from, to) > meta.maxRangeDays
    : false;
  const dateValid =
    (meta.dateMode === 'month' ? !!monthYear : meta.dateMode === 'date' ? !!asOfDate : !!from && !!to) &&
    !rangeTooLong;

  const fetchReportRows = async (): Promise<Record<string, unknown>[]> => {
    const body: Record<string, unknown> = { criteria };
    if (meta.dateMode === 'month') body.monthYear = monthYear;
    if (meta.dateMode === 'date') body.asOfDate = asOfDate;
    if (meta.dateMode === 'range') { body.fromDate = from; body.toDate = to; }
    if (meta.hasResignedFilter) body.includeResigned = includeResigned;
    const res = await fetch(meta.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
      const expRows = meta.deriveRows ? meta.deriveRows(r) : r;
      const dateSuffix = meta.dateMode === 'month' ? monthYear : `${from} to ${to}`;
      const filename = `${meta.label} - ${dateSuffix}`;
      if (groupBy) {
        const groups = groupRows(expRows, groupBy);
        if (kind === 'excel') exportGroupedReportToExcel(meta.columns, groups, currencyKeys, filename, { title: filename, slNo: meta.slNo, groupTotals: meta.groupTotals });
        else exportGroupedReportToPdf(meta.columns, groups, currencyKeys, filename, filename);
      } else {
        if (kind === 'excel') exportReportToExcel(meta.columns, expRows, filename, { title: filename, slNo: meta.slNo, totalKeys: currencyKeys.size ? currencyKeys : undefined });
        else exportReportToPdf(meta.columns, expRows, filename, filename, { slNo: meta.slNo, totalKeys: currencyKeys.size ? currencyKeys : undefined });
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
              Leave Report
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Leave detailed, leave balance, monthly leave taken, and comp off reports
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-5 py-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Report Type</label>
            <select
              value={subtype}
              onChange={(e) => { setSubtype(e.target.value as Subtype); setCriteria({}); setIncludeResigned(false); resetResults(); }}
              className={cn(INPUT_CLASS, 'min-w-[220px]')}
            >
              {Object.entries(SUBTYPE_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
            </select>
          </div>
          {meta.dateMode === 'month' ? (
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input type="month" value={monthYear} onChange={(e) => { setMonthYear(e.target.value); resetResults(); }} className={cn(INPUT_CLASS, 'pl-8')} />
              </div>
            </div>
          ) : meta.dateMode === 'date' ? (
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Select Date</label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input type="date" value={asOfDate} onChange={(e) => { setAsOfDate(e.target.value); resetResults(); }} className={cn(INPUT_CLASS, 'pl-8')} />
              </div>
            </div>
          ) : (
            <>
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
            </>
          )}
          <CriteriaFilterPanel
            reportType={subtype}
            values={criteria}
            onChange={(v) => { setCriteria(v); resetResults(); }}
            allowedCriteria={meta.allowedCriteria}
            includeResigned={meta.hasResignedFilter ? includeResigned : undefined}
            onIncludeResignedChange={meta.hasResignedFilter ? (v: boolean) => { setIncludeResigned(v); resetResults(); } : undefined}
          />
        </div>
        <div className="flex justify-end items-center gap-2">
          {!viewHidden && (
            <button
              onClick={() => generate.mutate()}
              disabled={generate.isPending || !dateValid || !hasCriteria}
              title="View Report"
              className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
            >
              {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={() => exportReport.mutate('excel')}
            disabled={exportReport.isPending || !dateValid || !hasCriteria}
            className={cn(BTN_SM, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
          >
            <Download className="w-3.5 h-3.5" /> Excel
          </button>
          <button
            onClick={() => exportReport.mutate('pdf')}
            disabled={exportReport.isPending || !dateValid || !hasCriteria}
            className={cn(BTN_SM, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
          >
            <Download className="w-3.5 h-3.5" /> PDF
          </button>
        </div>
        {rangeTooLong && (
          <p className="text-[12.5px] text-[color:var(--color-danger)]">
            The date range cannot exceed {meta.maxRangeDays} days.
          </p>
        )}
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
      ) : groupBy ? (
        <div className="space-y-4">
          {groupRows(displayRows, groupBy).map((group) => (
            <div key={group.key} className="surface-card rounded-2xl overflow-hidden overflow-x-auto">
              <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 text-[13px] font-semibold text-[#0F172A]">{group.key}</div>
              <table className="w-full text-[13px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {meta.slNo && <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Sl No</th>}
                    {meta.columns.map((c) => <th key={c.key} className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {group.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50/70">
                      {meta.slNo && <td className="px-4 py-2 text-[#0F172A] whitespace-nowrap">{i + 1}</td>}
                      {meta.columns.map((c) => (
                        <td key={c.key} className="px-4 py-2 text-[#0F172A] whitespace-nowrap">
                          {currencyKeys.has(c.key) ? String(row[c.key] ?? 0) : formatCellValue(row[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {meta.groupTotals !== false && currencyKeys.size > 0 && (
                  <tfoot className="bg-slate-50 font-medium">
                    <tr>
                      {meta.slNo && <td className="px-4 py-2 text-[#0F172A] whitespace-nowrap">Total</td>}
                      {meta.columns.map((c, i) => (
                        <td key={c.key} className="px-4 py-2 text-[#0F172A] whitespace-nowrap">
                          {!meta.slNo && i === 0 ? 'Total' : currencyKeys.has(c.key) ? sumColumn(group.rows, c.key) : ''}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          ))}
        </div>
      ) : (
        <div className="surface-card rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {meta.slNo && <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Sl No</th>}
                {meta.columns.map((c) => <th key={c.key} className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{c.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayRows.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50/70">
                  {meta.slNo && <td className="px-4 py-2 text-[#0F172A] whitespace-nowrap">{i + 1}</td>}
                  {meta.columns.map((c) => (
                    <td key={c.key} className="px-4 py-2 text-[#0F172A] whitespace-nowrap">
                      {currencyKeys.has(c.key) ? String(row[c.key] ?? 0) : formatCellValue(row[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {currencyKeys.size > 0 && (
              <tfoot className="bg-slate-50 font-medium">
                <tr>
                  {meta.slNo && <td className="px-4 py-2 text-[#0F172A] whitespace-nowrap">Total</td>}
                  {meta.columns.map((c, i) => (
                    <td key={c.key} className="px-4 py-2 text-[#0F172A] whitespace-nowrap">
                      {!meta.slNo && i === 0 ? 'Total' : currencyKeys.has(c.key) ? sumColumn(displayRows, c.key) : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
