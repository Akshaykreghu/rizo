'use client';

import { useState, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { Download, Play } from 'lucide-react';
import { CriteriaFilterPanel } from '@/components/reports/CriteriaFilterPanel';
import {
  exportReportToExcel, exportReportToPdf, exportSalarySlipsToExcel, exportSalarySlipsToPdf,
  exportGroupedReportToExcel, exportGroupedReportToPdf, type ReportColumn,
} from '@/lib/reportExport';
import { formatCurrency } from '@/lib/utils';

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
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
        <h3 className="font-semibold text-gray-900">
          {slip.emp_name}{slip.status === 2 ? ' (Resigned)' : ''} — {slip.designation ?? ''} — {slip.branch_name ?? ''}
        </h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 px-4 py-3 text-sm border-b border-gray-100">
        <div><span className="text-gray-500">Department:</span> {slip.department ?? '—'}</div>
        <div><span className="text-gray-500">Gender:</span> {slip.gender ?? '—'}</div>
        <div><span className="text-gray-500">Date of Joining:</span> {slip.joining_date ?? '—'}</div>
        <div><span className="text-gray-500">Leave Days:</span> {slip.leave_days}</div>
        <div><span className="text-gray-500">Present Days:</span> {slip.present_days}</div>
        <div><span className="text-gray-500">LOP Days:</span> {slip.lop_days}</div>
        <div><span className="text-gray-500">Week Off:</span> {slip.weekoff_days}</div>
        <div><span className="text-gray-500">Holidays:</span> {slip.holiday_days}</div>
        <div><span className="text-gray-500">PF Account No:</span> {slip.pf_account_no || '—'}</div>
        <div><span className="text-gray-500">ESI No:</span> {slip.esi_no || '—'}</div>
        <div><span className="text-gray-500">UAN No:</span> {slip.uan_no || '—'}</div>
        <div><span className="text-gray-500">Bank:</span> {slip.bank_name || '—'}</div>
        <div><span className="text-gray-500">Branch:</span> {slip.bank_branch || '—'}</div>
        <div><span className="text-gray-500">IFSC Code:</span> {slip.ifsc_code || '—'}</div>
        <div><span className="text-gray-500">Account No:</span> {slip.account_no || '—'}</div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="text-left px-4 py-2 font-medium text-gray-600">Earnings</th>
            <th className="text-right px-4 py-2 font-medium text-gray-600">Amount</th>
            <th className="text-left px-4 py-2 font-medium text-gray-600">Deductions</th>
            <th className="text-right px-4 py-2 font-medium text-gray-600">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rowCount === 0 && (
            <tr><td colSpan={4} className="px-4 py-4 text-center text-gray-400">No components found under this data</td></tr>
          )}
          {Array.from({ length: rowCount }).map((_, i) => (
            <tr key={i}>
              <td className="px-4 py-1.5 text-gray-700">{slip.earnings[i]?.label ?? ''}</td>
              <td className="px-4 py-1.5 text-right text-gray-700">{slip.earnings[i] ? formatCurrency(slip.earnings[i].amount) : ''}</td>
              <td className="px-4 py-1.5 text-gray-700">{slip.deductions[i]?.label ?? ''}</td>
              <td className="px-4 py-1.5 text-right text-gray-700">{slip.deductions[i] ? formatCurrency(slip.deductions[i].amount) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-100 font-medium">
          <tr>
            <td className="px-4 py-2">Total Earnings</td>
            <td className="px-4 py-2 text-right">{formatCurrency(slip.total_earnings)}</td>
            <td className="px-4 py-2">Total Deductions</td>
            <td className="px-4 py-2 text-right">{formatCurrency(slip.total_deductions)}</td>
          </tr>
          <tr>
            <td className="px-4 py-2" colSpan={3}>Net Pay</td>
            <td className="px-4 py-2 text-right">{formatCurrency(slip.net_pay)}</td>
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
  'current_ctc', 'previous_ctc', 'ctc_change',
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
  // Legacy pivots each employee's real salary-head items (Basic/HRA/etc, varies per company) into
  // their own columns on these 4 reports. Backend returns each row with an `items` array (see
  // getItemWiseAdditions() in reports.ts) instead of fixed columns, since the head set isn't known
  // ahead of time — 'plain' items are {label,amount}, 'comparison' items are
  // {label,current,previous,change} (Comparison compares two months' worth per head). Flattened
  // into synthetic per-label columns client-side (buildItemColumns() below) so the rest of the
  // page (grouping, totals, export) can treat them like any other column.
  itemPivot?: 'plain' | 'comparison';
}

const SUBTYPE_META: Record<Subtype, SubtypeMeta> = {
  SummaryPayroll: {
    label: 'Payroll Summary',
    groupBy: (r) => String(r.branch_name ?? ''),
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'departments', label: 'Department' }, { key: 'desig', label: 'Designation' },
      { key: 'joining_date', label: 'Joining Date' }, { key: 'termination_date', label: 'Termination Date' },
      { key: 'days_presant', label: 'Present Days' }, { key: 'days_leave', label: 'Leave Days' },
      { key: 'loss_of_pay', label: 'LOP Days' }, { key: 'weekoff_total', label: 'Week Off' }, { key: 'holiday_total', label: 'Holiday' },
      { key: 'monthly_ctc', label: 'Monthly CTC' }, { key: 'gross_salary', label: 'Gross Salary' },
      { key: 'total_deduction', label: 'Deductions' }, { key: 'net_salary', label: 'Net Salary' },
    ],
  },
  salary: {
    label: 'CTC Summary',
    groupBy: (r) => String(r.branch ?? ''),
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Employee' }, { key: 'branch', label: 'Branch' },
      { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' },
      { key: 'joining_date', label: 'Joining Date' }, { key: 'termination_date', label: 'Termination Date' },
      { key: 'emp_anual_ctc', label: 'Annual CTC' }, { key: 'start_date_effective', label: 'Effective From' },
      { key: 'next_increment_date', label: 'Next Increment' },
    ],
  },
  Grosssalary: {
    label: 'Gross Salary Detailed',
    itemPivot: 'plain',
    groupBy: (r) => String(r.branch_name ?? ''),
    columns: [
      { key: 'employee_id', label: 'Employee ID' }, { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'departments', label: 'Department' }, { key: 'desig', label: 'Designation' },
      { key: 'joining_date', label: 'Joining Date' }, { key: 'termination_date', label: 'Termination Date' },
      { key: 'days_presant', label: 'Present Days' }, { key: 'days_leave', label: 'Leave Days' },
      { key: 'loss_of_pay', label: 'LOP Days' }, { key: 'weekoff_total', label: 'Week Off' }, { key: 'holiday_total', label: 'Holiday' },
      { key: 'overtime_hours', label: 'Overtime (Hrs)' },
      { key: 'gross_salary', label: 'Gross Salary' }, { key: 'total_deduction', label: 'Deductions' },
      { key: 'total_variables', label: 'Variables' }, { key: 'net_salary', label: 'Net Salary' },
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

// Flattens each row's dynamic `items` array (per real salary-head-item, not known ahead of time —
// see itemPivot doc on SubtypeMeta) into synthetic keyed fields (`item__<label>` for a plain
// pivot, `item__<label>__previous/current/change` for Comparison's two-month version) so the rest
// of the page — grouping, Total rows, Excel/PDF export — can treat these like any other column
// without special-casing. Column order follows first-appearance order across rows (stable given
// the backend already orders items by salary_head_item_order1 per row).
function flattenItemColumns(
  rows: Record<string, unknown>[], itemPivot: 'plain' | 'comparison' | undefined
): { rows: Record<string, unknown>[]; columns: ReportColumn[] } {
  if (!itemPivot) return { rows, columns: [] };

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
  const { data: session } = useSession();
  const [subtype, setSubtype] = useState<Subtype>('SummaryPayroll');
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [toMonthYear, setToMonthYear] = useState(currentMonthYear());
  const [criteria, setCriteria] = useState<Record<string, string[]>>({});
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
  // Dynamic item-pivot columns are always currency amounts, but their keys aren't in the static
  // CURRENCY_KEYS set (they're per-real-salary-head, not known ahead of time) — extend it per render.
  const currencyKeys = useMemo(
    () => new Set([...CURRENCY_KEYS, ...itemColumns.map((c) => c.key)]),
    [itemColumns]
  );

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/reports/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtype, monthYear, toMonthYear: meta.dateRange ? toMonthYear : undefined, criteria }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Failed to generate report');
      return (b.rows ?? []) as Record<string, unknown>[];
    },
    onSuccess: (r) => { isSlip ? setSlips(r as unknown as SalarySlip[]) : setRows(r); setError(null); },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Payroll Report</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Report Type</label>
            <select
              value={subtype}
              onChange={(e) => { setSubtype(e.target.value as Subtype); setRows([]); setSlips([]); setCriteria({}); setError(null); generate.reset(); }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[180px]"
            >
              {Object.entries(SUBTYPE_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{meta.dateRange ? 'From Month' : 'Month'}</label>
            <input type="month" value={monthYear} onChange={(e) => setMonthYear(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          {meta.dateRange && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">To Month</label>
              <input type="month" value={toMonthYear} onChange={(e) => setToMonthYear(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
          <CriteriaFilterPanel reportType={subtype} values={criteria} onChange={setCriteria} />
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || !monthYear}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Play className="w-4 h-4" />
            {generate.isPending ? 'Generating…' : 'Generate'}
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!isSlip && displayRows.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={() => meta.groupBy
                ? exportGroupedReportToExcel(displayColumns, groupRows(displayRows, meta.groupBy), currencyKeys, `payroll_report_${monthYear}`)
                : exportReportToExcel(displayColumns, displayRows, `payroll_report_${monthYear}`)}
              className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm text-gray-700"
            >
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
            {meta.pdfAllowed && (
              <button
                onClick={() => meta.groupBy
                  ? exportGroupedReportToPdf(displayColumns, groupRows(displayRows, meta.groupBy), currencyKeys, `${meta.label} — ${monthYear}`, `payroll_report_${monthYear}`)
                  : exportReportToPdf(displayColumns, displayRows, `${meta.label} — ${monthYear}`, `payroll_report_${monthYear}`)}
                className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm text-gray-700"
              >
                <Download className="w-3.5 h-3.5" /> PDF
              </button>
            )}
          </div>
        )}
        {isSlip && slips.length > 0 && (
          <div className="flex gap-2">
            <button onClick={() => exportSalarySlipsToExcel(slips, session?.user?.companyCode ?? '', monthLabel(monthYear), `salary_slip_${monthYear}`)} className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm text-gray-700">
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
            <button onClick={() => exportSalarySlipsToPdf(slips, monthLabel(monthYear), `salary_slip_${monthYear}`)} className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm text-gray-700">
              <Download className="w-3.5 h-3.5" /> PDF
            </button>
          </div>
        )}
      </div>

      {isSlip ? (
        <div className="space-y-4">
          {slips.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-8 text-center text-gray-400">
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
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-8 text-center text-gray-400">
          {generate.isPending
            ? 'Loading...'
            : generate.isSuccess
              ? 'No records found for the selected criteria.'
              : 'Choose at least one criteria value and click Generate.'}
        </div>
      ) : meta.groupBy ? (
        <div className="space-y-4">
          {groupRows(displayRows, meta.groupBy).map((group) => (
            <div key={group.key} className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
              <div className="bg-gray-100 border-b border-gray-200 px-4 py-2 font-semibold text-gray-800">{group.key}</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>{displayColumns.map((c) => <th key={c.key} className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">{c.label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {group.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      {displayColumns.map((c) => (
                        <td key={c.key} className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {currencyKeys.has(c.key) ? formatCurrency(Number(row[c.key] ?? 0)) : String(row[c.key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 font-medium">
                  <tr>
                    {displayColumns.map((c, i) => (
                      <td key={c.key} className="px-4 py-2 text-gray-800 whitespace-nowrap">
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
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>{displayColumns.map((c) => <th key={c.key} className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayRows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  {displayColumns.map((c) => (
                    <td key={c.key} className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {currencyKeys.has(c.key) ? formatCurrency(Number(row[c.key] ?? 0)) : String(row[c.key] ?? '')}
                    </td>
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
