'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, Play } from 'lucide-react';
import { CriteriaFilterPanel } from '@/components/reports/CriteriaFilterPanel';
import { exportReportToExcel, exportReportToPdf, type ReportColumn } from '@/lib/reportExport';
import { formatCurrency } from '@/lib/utils';

type Subtype = 'SummaryPayroll' | 'salary' | 'Grosssalary' | 'BankTranfer' | 'Salaryslip'
  | 'MonthlyCTCReport' | 'PayrollCTC' | 'GrosssalaryNew' | 'Comparison' | 'GrosssalarySummary' | 'GrossPeriod';

const CURRENCY_KEYS = new Set([
  'monthly_ctc', 'gross_salary', 'total_deduction', 'net_salary', 'emp_anual_ctc', 'emp_derived_anualctc',
  'standard_total', 'variable_total', 'employer_total', 'other_total', 'total_gross', 'total_deductions',
  'total_net', 'current_net', 'previous_net', 'net_change', 'salary_amount',
]);

const SUBTYPE_META: Record<Subtype, { label: string; columns: ReportColumn[]; dateRange?: boolean }> = {
  SummaryPayroll: {
    label: 'Payroll Summary',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'departments', label: 'Department' }, { key: 'desig', label: 'Designation' },
      { key: 'days_presant', label: 'Present Days' }, { key: 'loss_of_pay', label: 'LOP Days' },
      { key: 'monthly_ctc', label: 'Monthly CTC' }, { key: 'gross_salary', label: 'Gross Salary' },
      { key: 'total_deduction', label: 'Deductions' }, { key: 'net_salary', label: 'Net Salary' },
    ],
  },
  salary: {
    label: 'CTC Summary',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch', label: 'Branch' },
      { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' },
      { key: 'emp_anual_ctc', label: 'Annual CTC' }, { key: 'start_date_effective', label: 'Effective From' },
      { key: 'next_increment_date', label: 'Next Increment' },
    ],
  },
  Grosssalary: {
    label: 'Gross Salary Detailed',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'departments', label: 'Department' }, { key: 'desig', label: 'Designation' },
      { key: 'gross_salary', label: 'Gross Salary' }, { key: 'total_deduction', label: 'Deductions' },
      { key: 'total_variables', label: 'Variables' }, { key: 'net_salary', label: 'Net Salary' },
    ],
  },
  BankTranfer: {
    label: 'Salary Bank Transfer',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'bank_details', label: 'Bank Details' }, { key: 'net_salary', label: 'Net Salary' },
    ],
  },
  Salaryslip: {
    label: 'Salary Slip',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'gross_salary', label: 'Gross Salary' }, { key: 'total_deduction', label: 'Deductions' },
      { key: 'net_salary', label: 'Net Salary' }, { key: 'bank_details', label: 'Bank Details' },
    ],
  },
  GrosssalaryNew: {
    label: 'Gross Salary Detail New',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'departments', label: 'Department' }, { key: 'desig', label: 'Designation' },
      { key: 'standard_total', label: 'Standard' }, { key: 'variable_total', label: 'Variable' },
      { key: 'gross_salary', label: 'Gross Salary' }, { key: 'net_salary', label: 'Net Salary' },
    ],
  },
  GrosssalarySummary: {
    label: 'Gross Salary Summary',
    columns: [
      { key: 'branch_name', label: 'Branch' }, { key: 'employee_count', label: 'Employees' },
      { key: 'total_gross', label: 'Total Gross' }, { key: 'total_deductions', label: 'Total Deductions' },
      { key: 'total_net', label: 'Total Net' },
    ],
  },
  GrossPeriod: {
    label: 'Gross Salary Period Wise',
    dateRange: true,
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'month_year', label: 'Month' }, { key: 'gross_salary', label: 'Gross Salary' },
      { key: 'total_deduction', label: 'Deductions' }, { key: 'net_salary', label: 'Net Salary' },
    ],
  },
  Comparison: {
    label: 'Salary Previous Month Comparison',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'previous_net', label: 'Previous Month Net' }, { key: 'current_net', label: 'Current Month Net' },
      { key: 'net_change', label: 'Change' },
    ],
  },
  MonthlyCTCReport: {
    label: 'Monthly CTC',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'desig', label: 'Designation' }, { key: 'salary_head', label: 'Salary Head' },
      { key: 'salary_amount', label: 'Amount' },
    ],
  },
  PayrollCTC: {
    label: 'Payroll CTC Report',
    columns: [
      { key: 'emp_name', label: 'Employee' }, { key: 'branch_name', label: 'Branch' },
      { key: 'standard_total', label: 'Standard' }, { key: 'variable_total', label: 'Variable' },
      { key: 'employer_total', label: 'Employer Contribution' }, { key: 'other_total', label: 'Other/Ad-hoc' },
      { key: 'net_salary', label: 'Net Salary' },
    ],
  },
};

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function PayrollReportPage() {
  const [subtype, setSubtype] = useState<Subtype>('SummaryPayroll');
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [toMonthYear, setToMonthYear] = useState(currentMonthYear());
  const [criteria, setCriteria] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);

  const meta = SUBTYPE_META[subtype];

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
    onSuccess: (r) => { setRows(r); setError(null); },
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
              onChange={(e) => { setSubtype(e.target.value as Subtype); setRows([]); setCriteria({}); setError(null); generate.reset(); }}
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
        {rows.length > 0 && (
          <div className="flex gap-2">
            <button onClick={() => exportReportToExcel(meta.columns, rows, `payroll_report_${monthYear}`)} className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm text-gray-700">
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
            <button onClick={() => exportReportToPdf(meta.columns, rows, `${meta.label} — ${monthYear}`, `payroll_report_${monthYear}`)} className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm text-gray-700">
              <Download className="w-3.5 h-3.5" /> PDF
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>{meta.columns.map((c) => <th key={c.key} className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">{c.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr><td colSpan={meta.columns.length} className="px-4 py-8 text-center text-gray-400">
                {generate.isPending
                  ? 'Loading...'
                  : generate.isSuccess
                    ? 'No records found for the selected criteria.'
                    : 'Choose at least one criteria value and click Generate.'}
              </td></tr>
            )}
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50">
                {meta.columns.map((c) => (
                  <td key={c.key} className="px-4 py-3 text-gray-700 whitespace-nowrap">
                    {CURRENCY_KEYS.has(c.key) ? formatCurrency(Number(row[c.key] ?? 0)) : String(row[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
