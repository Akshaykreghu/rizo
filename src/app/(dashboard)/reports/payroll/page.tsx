'use client';

import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { Download, Eye, Loader2, Calendar } from 'lucide-react';
import { CriteriaFilterPanel } from '@/components/reports/CriteriaFilterPanel';
import {
  exportReportToExcel, exportReportToPdf, exportSalarySlipsToExcel, exportSalarySlipsToPdf,
  exportGroupedReportToExcel, exportGroupedReportToPdf, type ReportColumn,
} from '@/lib/reportExport';
import { cn, formatCurrency } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

const INPUT_CLASS =
  'h-[42px] border border-[#E5E7EB] bg-white rounded-lg px-2.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'h-[42px] inline-flex items-center gap-1.5 px-4 rounded-lg text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const BTN_SM =
  'h-[38px] inline-flex items-center gap-1.5 px-3 rounded-lg text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

type Subtype = 'SummaryPayroll' | 'salary' | 'Grosssalary' | 'BankTranfer' | 'Salaryslip'
  | 'MonthlyCTCReport' | 'PayrollCTC' | 'GrosssalaryNew' | 'Comparison' | 'GrosssalarySummary' | 'GrossPeriod';

interface SalarySlipLineItem { label: string; amount: number; rate: number }
interface SalarySlip {
  emp_pkey: number;
  emp_name: string;
  employee_id: string | null;
  login_user_id: string | null;
  designation: string | null;
  department: string | null;
  branch_name: string | null;
  joining_date: string | null;
  termination_date: string | null;
  gender: string | null;
  status: number;
  leave_days: number;
  present_days: number;
  lop_days: number;
  weekoff_days: number;
  holiday_days: number;
  pf_account_no: string | null;
  esi_no: string | null;
  uan_no: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  ifsc_code: string | null;
  account_no: string | null;
  earnings: SalarySlipLineItem[];
  deductions: SalarySlipLineItem[];
  total_earnings: number;
  total_deductions: number;
  net_pay: number;
}

function SalarySlipCard({ slip }: { slip: SalarySlip }) {
  const rowCount = Math.max(slip.earnings.length, slip.deductions.length);
  return (
    <div className="surface-card rounded-2xl overflow-hidden">
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5">
        <h3 className="text-[13.5px] font-semibold text-[#0F172A]">
          {slip.emp_name}{slip.status === 2 ? ' (Resigned)' : ''} — {slip.designation ?? ''} — {slip.branch_name ?? ''}
        </h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 px-4 py-3 text-[12.5px] border-b border-slate-100">
        <div><span className="text-slate-500">Department:</span> {slip.department ?? '—'}</div>
        <div><span className="text-slate-500">Gender:</span> {slip.gender ?? '—'}</div>
        <div><span className="text-slate-500">Date of Joining:</span> {slip.joining_date ?? '—'}</div>
        <div><span className="text-slate-500">Leave Days:</span> {slip.leave_days}</div>
        <div><span className="text-slate-500">Present Days:</span> {slip.present_days}</div>
        <div><span className="text-slate-500">LOP Days:</span> {slip.lop_days}</div>
        <div><span className="text-slate-500">Week Off:</span> {slip.weekoff_days}</div>
        <div><span className="text-slate-500">Holidays:</span> {slip.holiday_days}</div>
        <div><span className="text-slate-500">PF Account No:</span> {slip.pf_account_no || '—'}</div>
        <div><span className="text-slate-500">ESI No:</span> {slip.esi_no || '—'}</div>
        <div><span className="text-slate-500">UAN No:</span> {slip.uan_no || '—'}</div>
        <div><span className="text-slate-500">Bank:</span> {slip.bank_name || '—'}</div>
        <div><span className="text-slate-500">Branch:</span> {slip.bank_branch || '—'}</div>
        <div><span className="text-slate-500">IFSC Code:</span> {slip.ifsc_code || '—'}</div>
        <div><span className="text-slate-500">Account No:</span> {slip.account_no || '—'}</div>
      </div>
      <table className="w-full text-[13px]">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left px-4 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Earnings</th>
            <th className="text-right px-4 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Amount</th>
            <th className="text-left px-4 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Deductions</th>
            <th className="text-right px-4 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rowCount === 0 && (
            <tr><td colSpan={4} className="px-4 py-4 text-center text-slate-400">No components found under this data</td></tr>
          )}
          {Array.from({ length: rowCount }).map((_, i) => (
            <tr key={i}>
              <td className="px-4 py-1.5 text-[#0F172A]">{slip.earnings[i]?.label ?? ''}</td>
              <td className="px-4 py-1.5 text-right text-[#0F172A]">{slip.earnings[i] ? formatCurrency(slip.earnings[i].amount) : ''}</td>
              <td className="px-4 py-1.5 text-[#0F172A]">{slip.deductions[i]?.label ?? ''}</td>
              <td className="px-4 py-1.5 text-right text-[#0F172A]">{slip.deductions[i] ? formatCurrency(slip.deductions[i].amount) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-slate-50 font-medium">
          <tr>
            <td className="px-4 py-2 text-[#0F172A]">Total Earnings</td>
            <td className="px-4 py-2 text-right text-[#0F172A]">{formatCurrency(slip.total_earnings)}</td>
            <td className="px-4 py-2 text-[#0F172A]">Total Deductions</td>
            <td className="px-4 py-2 text-right text-[#0F172A]">{formatCurrency(slip.total_deductions)}</td>
          </tr>
          <tr>
            <td className="px-4 py-2 text-[#0F172A]" colSpan={3}>Net Pay</td>
            <td className="px-4 py-2 text-right text-[#0F172A]">{formatCurrency(slip.net_pay)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const CURRENCY_KEYS = new Set([
  'monthly_ctc', 'gross_salary', 'total_deduction', 'net_salary', 'emp_anual_ctc', 'emp_derived_anualctc',
  'standard_total', 'variable_total', 'employer_total', 'other_total', 'total_gross', 'total_deductions',
  'total_net', 'current_net', 'previous_net', 'net_change', 'salary_amount',
  'current_gross', 'previous_gross', 'gross_change', 'current_deduction', 'previous_deduction', 'deduction_change',
  'current_ctc', 'previous_ctc', 'ctc_change', 'standard_gross_salary', 'settlement_amount', 'annual_ctc',
]);

// Legacy renders every one of these subtypes grouped by branch (a separate <table> per branch,
// with its own header and a Total/Total Deduction row) — confirmed by reading the real
// GrenerateXXXreport() functions in SalaryReportsController.php, not assumed. Our first port
// flattened everything into one ungrouped grid, the same kind of gap Salary Slip had. This fixes
// the on-screen view first (per explicit decision — Excel/PDF export for these subtypes still
// produce a flat sheet/table for now, a known follow-up, not silently matched to this view).
// `groupBy` names the row field to group on; BankTranfer groups by bank name, which isn't its own
// column — it's parsed out of the `bank_details` snapshot string instead (matching legacy, which
// groups this one report by bank, not branch).
function bankNameOf(row: Record<string, unknown>): string {
  const details = String(row.bank_details ?? '');
  return details.split(',')[0]?.trim() || 'Unknown Bank';
}

// Legacy only offers a PDF download for a specific subset of Payroll Report types (confirmed by
// user against the real legacy screen) — Salary Account, Salary Bank Transfer, Salary Bank
// Transfer_New, CTC Detail, Salary Slip, Gross Salary Summary. Of these, `Account`/`BankTranferNew`/
// `salarystructure` ("CTC Detail") aren't built yet (deferred earlier in Phase 6) — `pdfAllowed`
// is set on the 3 that are built (`BankTranfer`, `Salaryslip`, `GrosssalarySummary`) so it's ready
// to flip on for the other 3 if/when they're built. Every other subtype only offers Excel.
interface SubtypeMeta {
  label: string;
  columns: ReportColumn[];
  dateRange?: boolean;
  groupBy?: (row: Record<string, unknown>) => string;
  pdfAllowed?: boolean;
  // Excel-specific column set/order, used only when it needs to diverge from the on-screen grid —
  // e.g. SummaryPayroll's Excel export mirrors legacy's PHPExcel column order/labels exactly
  // (Sl No, no redundant Branch column since branch is already the group header, no Monthly CTC —
  // legacy's Excel never had it), while the on-screen grid keeps the richer column set. Falls back
  // to `columns` when unset.
  excelColumns?: ReportColumn[];
  excelSlNo?: boolean;
  // For flat (non-grouped) subtypes only — CTC Summary is the one report on this screen legacy
  // renders as a single flat table (not per-branch groups) with Sl No numbering and a grand-total
  // footer row, both on screen and in Excel/PDF (unlike SummaryPayroll's Excel-only excelSlNo).
  slNo?: boolean;
  showTotal?: boolean;
  // Legacy pivots each employee's real salary-head items (Basic/HRA/etc, varies per company) into
  // their own columns on these 4 reports. Backend returns each row with an `items` array (see
  // getItemWiseAdditions() in reports.ts) instead of fixed columns, since the head set isn't known
  // ahead of time — 'plain' items are {label,amount}, 'comparison' items are
  // {label,current,previous,change} (Comparison compares two months' worth per head). Flattened
  // into synthetic per-label columns client-side (buildItemColumns() below) so the rest of the
  // page (grouping, totals, export) can treat them like any other column.
  itemPivot?: 'plain' | 'comparison' | 'grossDetailed';
}

const SUBTYPE_META: Record<Subtype, SubtypeMeta> = {
  SummaryPayroll: {
    label: 'Payroll Summary',
    groupBy: (r) => String(r.branch_name ?? ''),
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'login_user_id', label: 'User ID' }, { key: 'emp_name', label: 'Employee' },
      { key: 'branch_name', label: 'Branch' },
      { key: 'departments', label: 'Department' }, { key: 'desig', label: 'Designation' },
      { key: 'joining_date', label: 'Joining Date' }, { key: 'termination_date', label: 'Termination Date' },
      { key: 'days_presant', label: 'Present Days' }, { key: 'days_leave', label: 'Leave Days' },
      { key: 'loss_of_pay', label: 'LOP Days' }, { key: 'weekoff_total', label: 'Week Off' }, { key: 'holiday_total', label: 'Holiday' },
      { key: 'monthly_ctc', label: 'Monthly CTC' }, { key: 'standard_gross_salary', label: 'Standard Gross Salary' },
      { key: 'gross_salary', label: 'Gross Salary' },
      { key: 'total_deduction', label: 'Deductions' }, { key: 'settlement_amount', label: 'Settlement Amount' },
      { key: 'net_salary', label: 'Net Salary' }, { key: 'approved_label', label: 'Approved' },
    ],
    // Mirrors legacy's branch-wise PHPExcel header exactly (SalaryReportsController.php:12105-12151):
    // Sl No (added by the exporter via excelSlNo), Employee ID, User ID, Employee Name, Designation,
    // Department, Date Of Joining, Date of Termination, Present Days, Week Off, Holiday, Leave Days,
    // Loss Off Pay, Standard Gross Salary, This Month Gross Salary, Total Deductions, Settlement
    // Amount, Net Salary, Approved. No Branch column (redundant — branch is already the group
    // header) and no Month column (redundant — the whole report is already scoped to one month) or
    // Monthly CTC (not part of legacy's Excel output at all, unlike the on-screen grid above).
    excelSlNo: true,
    excelColumns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'login_user_id', label: 'User ID' }, { key: 'emp_name', label: 'Employee Name' },
      { key: 'desig', label: 'Designation' }, { key: 'departments', label: 'Department' },
      { key: 'joining_date', label: 'Date Of Joining' }, { key: 'termination_date', label: 'Date of Termination' },
      { key: 'days_presant', label: 'Present Days' }, { key: 'weekoff_total', label: 'Week Off' }, { key: 'holiday_total', label: 'Holiday' },
      { key: 'days_leave', label: 'Leave Days' }, { key: 'loss_of_pay', label: 'Loss Off Pay' },
      { key: 'standard_gross_salary', label: 'Standard Gross Salary' }, { key: 'gross_salary', label: 'This Month Gross Salary' },
      { key: 'total_deduction', label: 'Total Deductions' }, { key: 'settlement_amount', label: 'Settlement Amount' },
      { key: 'net_salary', label: 'Net Salary' }, { key: 'approved_label', label: 'Approved' },
    ],
  },
  salary: {
    // Mirrors legacy's generic generatesalaryreport() screen/Excel output exactly
    // (SalaryReportsController.php:12680-12694, reportsalary.ctp) — a single flat table (legacy
    // never branch-groups this report, unlike SummaryPayroll) with Sl No and a bold grand-total row
    // summing Monthly CTC / Annual CTC.
    label: 'CTC Summary',
    slNo: true,
    showTotal: true,
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'login_user_id', label: 'User ID' }, { key: 'emp_name', label: 'Employee Name' },
      { key: 'joining_date', label: 'Joining Date' }, { key: 'branch_name', label: 'Branch' },
      { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' },
      { key: 'termination_date', label: 'Termination Date' },
      { key: 'monthly_ctc', label: 'Monthly CTC' }, { key: 'annual_ctc', label: 'Annual CTC' },
    ],
  },
  Grosssalary: {
    // Mirrors legacy's GenerateSalaryGrossNonExemted() exactly (SalaryReportsController.php:
    // 42057-43849) — one flat table (never branch-grouped) with Sl No, a grand-total row, and a
    // dynamic Standard/Actual salary-head pivot (see flattenItemColumns' 'grossDetailed' case and
    // buildGrossPivotRow in reports.ts) instead of trusting payroll_master's stored totals.
    label: 'Gross Salary Detailed',
    itemPivot: 'grossDetailed',
    slNo: true,
    showTotal: true,
    pdfAllowed: true,
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'login_user_id', label: 'User ID' }, { key: 'emp_name', label: 'Employee Name' },
      { key: 'joining_date', label: 'Joining Date' }, { key: 'branch_name', label: 'Branch' },
      { key: 'departments', label: 'Department' }, { key: 'desig', label: 'Designation' },
      { key: 'termination_date', label: 'Termination Date' },
      { key: 'days_presant', label: 'Present Days' }, { key: 'overtime_hours', label: 'Overtime (In Hrs.)' },
      { key: 'non_paying_days', label: 'Non Paying Days' }, { key: 'lop_days', label: 'LOP Days' },
      { key: 'days_leave', label: 'Leave Days' }, { key: 'weekoff_total', label: 'Week Off' }, { key: 'holiday_total', label: 'Holiday' },
    ],
  },
  BankTranfer: {
    label: 'Salary Bank Transfer',
    pdfAllowed: true,
    groupBy: bankNameOf,
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'departments', label: 'Department' }, { key: 'desig', label: 'Designation' },
      { key: 'joining_date', label: 'Joining Date' }, { key: 'termination_date', label: 'Termination Date' },
      { key: 'bank_name', label: 'Bank Name' }, { key: 'bank_branch', label: 'Bank Branch' },
      { key: 'ifsc_code', label: 'IFSC Code' }, { key: 'account_no', label: 'Account Number' },
      { key: 'net_salary', label: 'Net Salary' },
    ],
  },
  Salaryslip: {
    label: 'Salary Slip',
    columns: [], // rendered as payslip cards instead of the generic grid — see SalarySlipCard below
  },
  GrosssalaryNew: {
    label: 'Gross Salary Detail New',
    itemPivot: 'plain',
    groupBy: (r) => String(r.branch_name ?? ''),
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'departments', label: 'Department' }, { key: 'desig', label: 'Designation' },
      { key: 'joining_date', label: 'Joining Date' }, { key: 'termination_date', label: 'Termination Date' },
      { key: 'days_presant', label: 'Present Days' }, { key: 'days_leave', label: 'Leave Days' },
      { key: 'loss_of_pay', label: 'LOP Days' }, { key: 'weekoff_total', label: 'Week Off' }, { key: 'holiday_total', label: 'Holiday' },
      { key: 'overtime_hours', label: 'Overtime (Hrs)' },
      { key: 'standard_total', label: 'Standard' }, { key: 'variable_total', label: 'Variable' },
      { key: 'gross_salary', label: 'Gross Salary' }, { key: 'total_deduction', label: 'Deductions' }, { key: 'net_salary', label: 'Net Salary' },
    ],
  },
  GrosssalarySummary: {
    // Real legacy report is employee-level detail grouped by branch, not branch totals — see
    // generateSalarySlips-adjacent comment in reports.ts for the correction and why.
    label: 'Gross Salary Summary',
    pdfAllowed: true,
    groupBy: (r) => String(r.branch_name ?? ''),
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'departments', label: 'Department' }, { key: 'desig', label: 'Designation' },
      { key: 'days_presant', label: 'Present Days' }, { key: 'days_leave', label: 'Leave Days' },
      { key: 'loss_of_pay', label: 'LOP Days' }, { key: 'weekoff_total', label: 'Week Off' }, { key: 'holiday_total', label: 'Holiday' },
      { key: 'gross_salary', label: 'Gross Salary' }, { key: 'total_deduction', label: 'Deductions' }, { key: 'net_salary', label: 'Net Salary' },
    ],
  },
  GrossPeriod: {
    label: 'Gross Salary Period Wise',
    dateRange: true,
    groupBy: (r) => String(r.branch_name ?? ''),
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'departments', label: 'Department' }, { key: 'desig', label: 'Designation' }, { key: 'gender', label: 'Gender' },
      { key: 'joining_date', label: 'Joining Date' }, { key: 'termination_date', label: 'Termination Date' },
      { key: 'days_presant', label: 'Present Days' }, { key: 'month_year', label: 'Month' },
      { key: 'gross_salary', label: 'Gross Salary' }, { key: 'total_deduction', label: 'Deductions' }, { key: 'net_salary', label: 'Net Salary' },
    ],
  },
  Comparison: {
    label: 'Salary Previous Month Comparison',
    itemPivot: 'comparison',
    groupBy: (r) => String(r.branch_name ?? ''),
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'departments', label: 'Department' }, { key: 'desig', label: 'Designation' },
      { key: 'joining_date', label: 'Joining Date' }, { key: 'termination_date', label: 'Termination Date' },
      { key: 'previous_ctc', label: 'Previous CTC' }, { key: 'current_ctc', label: 'Current CTC' }, { key: 'ctc_change', label: 'CTC Change' },
      { key: 'previous_gross', label: 'Previous Gross' }, { key: 'current_gross', label: 'Current Gross' }, { key: 'gross_change', label: 'Gross Change' },
      { key: 'previous_deduction', label: 'Previous Deductions' }, { key: 'current_deduction', label: 'Current Deductions' }, { key: 'deduction_change', label: 'Deductions Change' },
      { key: 'previous_net', label: 'Previous Net' }, { key: 'current_net', label: 'Current Net' }, { key: 'net_change', label: 'Net Change' },
      { key: 'previous_pay_days', label: 'Previous Pay Days' }, { key: 'current_pay_days', label: 'Current Pay Days' }, { key: 'pay_days_change', label: 'Pay Days Change' },
    ],
  },
  MonthlyCTCReport: {
    label: 'Monthly CTC',
    groupBy: (r) => String(r.branch_name ?? ''),
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'departments', label: 'Department' }, { key: 'desig', label: 'Designation' },
      { key: 'salary_head', label: 'Salary Head' }, { key: 'salary_amount', label: 'Amount' },
    ],
  },
  PayrollCTC: {
    label: 'Payroll CTC Report',
    itemPivot: 'plain',
    groupBy: (r) => String(r.branch_name ?? ''),
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'departments', label: 'Department' }, { key: 'desig', label: 'Designation' }, { key: 'gender', label: 'Gender' },
      { key: 'present_days', label: 'Present Days' }, { key: 'leave_days', label: 'Leave Days' }, { key: 'lop_days', label: 'LOP Days' },
      { key: 'weekoff_total', label: 'Week Off' }, { key: 'holiday_total', label: 'Holiday' },
      { key: 'standard_total', label: 'Standard' }, { key: 'variable_total', label: 'Variable' },
      { key: 'employer_total', label: 'Employer Contribution' }, { key: 'other_total', label: 'Other/Ad-hoc' },
      { key: 'total_deduction', label: 'Deductions' }, { key: 'net_salary', label: 'Net Salary' },
    ],
  },
};

function groupRows(rows: Record<string, unknown>[], groupBy: (row: Record<string, unknown>) => string) {
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

interface PlainItem { label: string; amount: number }
interface ComparisonItem { label: string; current: number; previous: number; change: number }
interface GrossItem { label: string; amount: number }

// Flattens each row's dynamic `items` array (per real salary-head-item, not known ahead of time —
// see itemPivot doc on SubtypeMeta) into synthetic keyed fields (`item__<label>` for a plain
// pivot, `item__<label>__previous/current/change` for Comparison's two-month version) so the rest
// of the page — grouping, Total rows, Excel/PDF export — can treat these like any other column
// without special-casing. Column order follows first-appearance order across rows (stable given
// the backend already orders items by salary_head_item_order1 per row).
//
// 'grossDetailed' (Gross Salary Detailed only) is a fourth shape: the backend already returns each
// row zero-filled and in a fixed order across every row (see buildGrossPivotRow in reports.ts), so
// columns are derived from the first row rather than by first-appearance scanning. It mirrors
// legacy's exact section order — Standard Addition items, Gross Salary (Standard), Standard
// Deduction items, Actual Addition items, Gross Salary (Actual), Actual Deduction items, Total
// Deduction, Settlement Amount, Net Salary — with "(Standard)"/"(Actual)" suffixes disambiguating
// the two sections' identically-named columns in this page's single flat header row (legacy uses a
// two-row merged super-header instead; the Excel export reproduces that merge, see exportReport).
function flattenItemColumns(
  rows: Record<string, unknown>[], itemPivot: 'plain' | 'comparison' | 'grossDetailed' | undefined
): { rows: Record<string, unknown>[]; columns: ReportColumn[] } {
  if (!itemPivot) return { rows, columns: [] };

  if (itemPivot === 'grossDetailed') {
    const labelsOf = (key: string) => (rows[0]?.[key] as GrossItem[] | undefined)?.map((i) => i.label) ?? [];
    const standardAdditionLabels = labelsOf('standardAddition');
    const standardDeductionLabels = labelsOf('standardDeduction');
    const actualAdditionLabels = labelsOf('actualAddition');
    const actualDeductionLabels = labelsOf('actualDeduction');

    const flatRows = rows.map((row) => {
      const flat: Record<string, unknown> = { ...row };
      ((row.standardAddition as GrossItem[] | undefined) ?? []).forEach((i) => { flat[`sa__${i.label}`] = i.amount; });
      ((row.standardDeduction as GrossItem[] | undefined) ?? []).forEach((i) => { flat[`sd__${i.label}`] = i.amount; });
      ((row.actualAddition as GrossItem[] | undefined) ?? []).forEach((i) => { flat[`aa__${i.label}`] = i.amount; });
      ((row.actualDeduction as GrossItem[] | undefined) ?? []).forEach((i) => { flat[`ad__${i.label}`] = i.amount; });
      flat.gross_standard = row.standardGross;
      flat.gross_actual = row.actualGross;
      flat.total_deduction = row.totalDeduction;
      flat.net_salary = row.netSalary;
      return flat;
    });

    const columns: ReportColumn[] = [
      ...standardAdditionLabels.map((label) => ({ key: `sa__${label}`, label: `${label} (Standard)` })),
      { key: 'gross_standard', label: 'Gross Salary (Standard)' },
      ...standardDeductionLabels.map((label) => ({ key: `sd__${label}`, label: `${label} (Standard)` })),
      ...actualAdditionLabels.map((label) => ({ key: `aa__${label}`, label: `${label} (Actual)` })),
      { key: 'gross_actual', label: 'Gross Salary (Actual)' },
      ...actualDeductionLabels.map((label) => ({ key: `ad__${label}`, label: `${label} (Actual)` })),
      { key: 'total_deduction', label: 'Total Deduction' },
      { key: 'settlement_amount', label: 'Settlement Amount' },
      { key: 'net_salary', label: 'Net Salary' },
    ];
    return { rows: flatRows, columns };
  }

  const labels: string[] = [];
  const flatRows = rows.map((row) => {
    const items = (row.items as (PlainItem | ComparisonItem)[] | undefined) ?? [];
    const flat: Record<string, unknown> = { ...row };
    for (const item of items) {
      if (!labels.includes(item.label)) labels.push(item.label);
      if (itemPivot === 'plain') {
        flat[`item__${item.label}`] = (item as PlainItem).amount;
      } else {
        const c = item as ComparisonItem;
        flat[`item__${item.label}__previous`] = c.previous;
        flat[`item__${item.label}__current`] = c.current;
        flat[`item__${item.label}__change`] = c.change;
      }
    }
    return flat;
  });

  const columns: ReportColumn[] = itemPivot === 'plain'
    ? labels.map((label) => ({ key: `item__${label}`, label }))
    : labels.flatMap((label) => [
        { key: `item__${label}__previous`, label: `${label} (Prev)` },
        { key: `item__${label}__current`, label: `${label} (Curr)` },
        { key: `item__${label}__change`, label: `${label} (Change)` },
      ]);

  return { rows: flatRows, columns };
}

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(monthYear: string) {
  const [y, m] = monthYear.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

export default function PayrollReportPage() {
  const { slotEl } = useHeaderSlot();
  const { data: session } = useSession();
  const [subtype, setSubtype] = useState<Subtype>('SummaryPayroll');
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [toMonthYear, setToMonthYear] = useState(currentMonthYear());
  const [criteria, setCriteria] = useState<Record<string, string[]>>({});
  const [includeResigned, setIncludeResigned] = useState(false);
  const [includeNegative, setIncludeNegative] = useState(false);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [slips, setSlips] = useState<SalarySlip[]>([]);
  const [error, setError] = useState<string | null>(null);

  const meta = SUBTYPE_META[subtype];
  const isSlip = subtype === 'Salaryslip';

  const { rows: displayRows, columns: itemColumns } = useMemo(
    () => flattenItemColumns(rows, meta.itemPivot),
    [rows, meta.itemPivot]
  );
  const displayColumns = useMemo(() => [...meta.columns, ...itemColumns], [meta.columns, itemColumns]);
  // Sl No is a computed row position, not a real field — prepended for on-screen display only when
  // meta.slNo (CTC Summary's flat table); the export mutation computes its own copy independently.
  const flatDisplayColumns = meta.slNo ? [{ key: '__slno', label: 'Sl No' }, ...displayColumns] : displayColumns;
  // Dynamic item-pivot columns are always currency amounts, but their keys aren't in the static
  // CURRENCY_KEYS set (they're per-real-salary-head, not known ahead of time) — extend it per render.
  const currencyKeys = useMemo(
    () => new Set([...CURRENCY_KEYS, ...itemColumns.map((c) => c.key)]),
    [itemColumns]
  );
  const hasCriteria = Object.values(criteria).some((v) => Array.isArray(v) && v.length > 0);
  // Which subtypes have a real, wired-up "Include Resigned" / "Include Negative Salary" filter —
  // legacy's checkboxes only affect the report data itself for these subtypes; other subtypes render
  // the shared employee-picker's own resigned toggle (via EmployeeChecklist) but nothing report-level.
  const hasResignedFilter = subtype === 'SummaryPayroll' || subtype === 'salary' || subtype === 'Grosssalary';
  const hasNegativeFilter = subtype === 'SummaryPayroll' || subtype === 'Grosssalary';
  // These subtypes' Excel filename/title mirror legacy's PHPExcel output exactly — every other
  // subtype keeps the existing generic pattern.
  const excelFilename = subtype === 'SummaryPayroll'
    ? `${session?.user?.companyCode ?? ''} Payroll Summary Report ${monthYear}`
    : subtype === 'salary'
    ? `${session?.user?.companyCode ?? ''} CTC Summary`
    : subtype === 'Grosssalary'
    ? `${session?.user?.companyCode ?? ''}_GrossSalaryDetailed${monthYear}`
    : `payroll_report_${monthYear}`;
  const excelTitle = subtype === 'SummaryPayroll'
    ? `Payroll Summary Report - ${monthYear}`
    : subtype === 'salary'
    ? 'Cost To Company(CTC) Summary'
    : subtype === 'Grosssalary'
    ? `Gross Salary Detailed Report for ${monthYear}`
    : undefined;

  // Shared by the View action and by Excel/PDF export — legacy's Excel/PDF buttons are independent
  // actions that fetch and generate their own output rather than requiring a prior View click, so
  // Excel/PDF here do the same: fetch fresh data for the current filters on click instead of only
  // being able to export whatever the last View happened to load.
  const fetchReportRows = async (): Promise<Record<string, unknown>[]> => {
    const res = await fetch('/api/reports/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subtype, monthYear, toMonthYear: meta.dateRange ? toMonthYear : undefined, criteria,
        includeResigned: hasResignedFilter ? includeResigned : undefined,
        includeNegative: hasNegativeFilter ? includeNegative : undefined,
      }),
    });
    const b = await res.json();
    if (!res.ok) throw new Error(b.error ?? 'Failed to generate report');
    return (b.rows ?? []) as Record<string, unknown>[];
  };

  const generate = useMutation({
    mutationFn: fetchReportRows,
    onSuccess: (r) => { isSlip ? setSlips(r as unknown as SalarySlip[]) : setRows(r); setError(null); },
    onError: (err: Error) => setError(err.message),
  });

  const exportReport = useMutation({
    mutationFn: async (kind: 'excel' | 'pdf') => {
      const r = await fetchReportRows();
      if (isSlip) {
        const slipData = r as unknown as SalarySlip[];
        if (kind === 'excel') exportSalarySlipsToExcel(slipData, session?.user?.companyCode ?? '', monthLabel(monthYear), `salary_slip_${monthYear}`);
        else exportSalarySlipsToPdf(slipData, monthLabel(monthYear), `salary_slip_${monthYear}`);
        return;
      }
      const { rows: expRows, columns: itemCols } = flattenItemColumns(r, meta.itemPivot);
      const screenColumns = [...meta.columns, ...itemCols];
      const curKeys = new Set([...CURRENCY_KEYS, ...itemCols.map((c) => c.key)]);
      // Gross Salary Detailed's Excel export reproduces legacy's merged two-row super-header
      // (Employee Details / Standard Salary / Actual Salary) — the flat HTML view instead
      // disambiguates the two sections with "(Standard)"/"(Actual)" suffixes on each column label
      // (see flattenItemColumns' 'grossDetailed' case), since a single <thead><tr> can't merge cells.
      const superHeaders = meta.itemPivot === 'grossDetailed'
        ? [
            { label: 'Employee Details', span: (meta.slNo ? 1 : 0) + meta.columns.length },
            { label: 'Standard Salary', span: itemCols.filter((c) => c.key.startsWith('sa__') || c.key.startsWith('sd__') || c.key === 'gross_standard').length },
            { label: 'Actual Salary', span: itemCols.filter((c) => c.key.startsWith('aa__') || c.key.startsWith('ad__') || ['gross_actual', 'total_deduction', 'settlement_amount', 'net_salary'].includes(c.key)).length },
          ]
        : undefined;
      if (kind === 'excel') {
        if (meta.groupBy) exportGroupedReportToExcel(meta.excelColumns ?? screenColumns, groupRows(expRows, meta.groupBy), curKeys, excelFilename, { title: excelTitle, slNo: meta.excelSlNo });
        else exportReportToExcel(meta.excelColumns ?? screenColumns, expRows, excelFilename, { title: excelTitle, slNo: meta.slNo, totalKeys: meta.showTotal ? curKeys : undefined, superHeaders });
      } else {
        if (meta.groupBy) exportGroupedReportToPdf(screenColumns, groupRows(expRows, meta.groupBy), curKeys, `${meta.label} — ${monthYear}`, `payroll_report_${monthYear}`);
        else exportReportToPdf(screenColumns, expRows, `${meta.label} — ${monthYear}`, `payroll_report_${monthYear}`, { slNo: meta.slNo, totalKeys: meta.showTotal ? curKeys : undefined });
      }
    },
    onError: (err: Error) => setError(err.message),
  });

  // Any filter change invalidates the currently displayed View results — without this, changing the
  // month/criteria/checkboxes after a successful View would leave the previous run's rows on screen.
  const resetResults = () => { setRows([]); setSlips([]); setError(null); generate.reset(); };

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Payroll Report
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Summary, CTC, gross salary, bank transfer, and salary slip reports
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
              onChange={(e) => { setSubtype(e.target.value as Subtype); setCriteria({}); setIncludeResigned(false); setIncludeNegative(false); resetResults(); }}
              className={cn(INPUT_CLASS, 'min-w-[180px]')}
            >
              {Object.entries(SUBTYPE_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
            </select>
          </div>
          {subtype !== 'salary' && (
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">{meta.dateRange ? 'From Month' : 'Month'}</label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input type="month" value={monthYear} onChange={(e) => { setMonthYear(e.target.value); resetResults(); }} className={cn(INPUT_CLASS, 'pl-8')} />
              </div>
            </div>
          )}
          {meta.dateRange && (
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">To Month</label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input type="month" value={toMonthYear} onChange={(e) => { setToMonthYear(e.target.value); resetResults(); }} className={cn(INPUT_CLASS, 'pl-8')} />
              </div>
            </div>
          )}
          <CriteriaFilterPanel
            reportType={subtype}
            values={criteria}
            onChange={(v) => { setCriteria(v); resetResults(); }}
            includeResigned={hasResignedFilter ? includeResigned : undefined}
            onIncludeResignedChange={hasResignedFilter ? (v: boolean) => { setIncludeResigned(v); resetResults(); } : undefined}
          />
        </div>
        {hasResignedFilter && (
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={includeResigned} onChange={(e) => { setIncludeResigned(e.target.checked); resetResults(); }} />
              Include Resigned
            </label>
            {hasNegativeFilter && (
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={includeNegative} onChange={(e) => { setIncludeNegative(e.target.checked); resetResults(); }} />
                Include Negative Salary
              </label>
            )}
          </div>
        )}
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
          {(isSlip || meta.pdfAllowed) && (
            <button
              onClick={() => exportReport.mutate('pdf')}
              disabled={exportReport.isPending || !monthYear || !hasCriteria}
              className={cn(BTN_SM, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
            >
              <Download className="w-3.5 h-3.5" /> PDF
            </button>
          )}
        </div>
        {error && <p className="text-[12.5px] text-[color:var(--color-danger)]">{error}</p>}
      </div>

      {generate.isSuccess && (
        <h2 className="text-[13px] font-semibold text-[#0F172A] mb-2">Report Results</h2>
      )}

      {isSlip ? (
        <div className="space-y-4">
          {slips.length === 0 && (
            <div className="surface-card rounded-xl px-4 py-8 text-center text-[12.5px] text-slate-400">
              {generate.isPending
                ? 'Loading...'
                : generate.isSuccess
                  ? 'No records found for the selected criteria.'
                  : 'Choose at least one criteria value and click Generate.'}
            </div>
          )}
          {slips.map((slip) => <SalarySlipCard key={slip.emp_pkey} slip={slip} />)}
        </div>
      ) : displayRows.length === 0 ? (
        <div className="surface-card rounded-xl px-4 py-8 text-center text-[12.5px] text-slate-400">
          {generate.isPending
            ? 'Loading...'
            : generate.isSuccess
              ? 'No records found for the selected criteria.'
              : 'Choose at least one criteria value and click Generate.'}
        </div>
      ) : meta.groupBy ? (
        <div className="space-y-4">
          {groupRows(displayRows, meta.groupBy).map((group) => (
            <div key={group.key} className="surface-card rounded-2xl overflow-hidden overflow-x-auto">
              <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 text-[13px] font-semibold text-[#0F172A]">{group.key}</div>
              <table className="w-full text-[13px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>{displayColumns.map((c) => <th key={c.key} className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{c.label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {group.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50/70">
                      {displayColumns.map((c) => (
                        <td key={c.key} className="px-4 py-2 text-[#0F172A] whitespace-nowrap">
                          {currencyKeys.has(c.key) ? formatCurrency(Number(row[c.key] ?? 0)) : String(row[c.key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-medium">
                  <tr>
                    {displayColumns.map((c, i) => (
                      <td key={c.key} className="px-4 py-2 text-[#0F172A] whitespace-nowrap">
                        {i === 0
                          ? 'Total'
                          : currencyKeys.has(c.key) ? formatCurrency(sumColumn(group.rows, c.key)) : ''}
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
              <tr>{flatDisplayColumns.map((c) => <th key={c.key} className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayRows.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50/70">
                  {flatDisplayColumns.map((c) => (
                    <td key={c.key} className="px-4 py-2 text-[#0F172A] whitespace-nowrap">
                      {c.key === '__slno' ? i + 1 : currencyKeys.has(c.key) ? formatCurrency(Number(row[c.key] ?? 0)) : String(row[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {meta.showTotal && (
              <tfoot className="bg-slate-50 font-medium">
                <tr>
                  {flatDisplayColumns.map((c, i) => (
                    <td key={c.key} className="px-4 py-2 text-[#0F172A] whitespace-nowrap">
                      {i === 0
                        ? 'Total'
                        : currencyKeys.has(c.key) ? formatCurrency(sumColumn(displayRows, c.key)) : ''}
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
