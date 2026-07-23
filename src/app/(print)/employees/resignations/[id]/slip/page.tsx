'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface SlipLine {
  salary_head_item_desc: string;
  salary_amount: number;
}
interface SlipData {
  employee: {
    first_name: string; last_name: string | null; emp_id: string | null;
    designation: string | null; department: string | null; branch: string | null; joining_date: string | null;
  };
  reason: string;
  resignationDetails: {
    submittedDate: string; noticePeriod: number; lastWorkingDate: string; approvedLastWorkingDate: string;
  };
  additions: SlipLine[];
  deductions: SlipLine[];
  netSalary: number;
  noticePay: number;
  leaveBalance: number;
  workingDaysSettled: number;
}

export default function ViewSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data, isLoading, error } = useQuery<SlipData>({
    queryKey: ['resignation-slip', id],
    queryFn: () => fetch(`/api/resignations/${id}/slip`).then(async (r) => {
      if (!r.ok) throw new Error((await r.json()).error ?? 'Failed to load slip');
      return r.json();
    }),
  });

  if (isLoading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>;
  if (error || !data) return <div className="p-8 text-red-600 text-sm">{String(error) || 'Slip not found'}</div>;

  return (
    <div className="max-w-2xl mx-auto p-8 print:p-0">
      <div className="flex justify-end mb-6 print:hidden">
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Printer className="w-4 h-4" /> Print
        </button>
      </div>

      <h1 className="text-xl font-semibold text-center mb-1">FULL &amp; FINAL SETTLEMENT STATEMENT</h1>
      <p className="text-center text-sm text-gray-500 mb-6">Service Particulars</p>

      <table className="w-full text-sm mb-6">
        <tbody>
          <tr><td className="py-1 text-gray-500 w-1/2">Name of Employee</td><td className="py-1 font-medium">{data.employee.first_name} {data.employee.last_name ?? ''}</td></tr>
          <tr><td className="py-1 text-gray-500">Employee ID</td><td className="py-1 font-medium">{data.employee.emp_id ?? '—'}</td></tr>
          <tr><td className="py-1 text-gray-500">Designation</td><td className="py-1 font-medium">{data.employee.designation ?? '—'}</td></tr>
          <tr><td className="py-1 text-gray-500">Department</td><td className="py-1 font-medium">{data.employee.department ?? '—'}</td></tr>
          <tr><td className="py-1 text-gray-500">Branch</td><td className="py-1 font-medium">{data.employee.branch ?? '—'}</td></tr>
          <tr><td className="py-1 text-gray-500">Date of Joining</td><td className="py-1 font-medium">{data.employee.joining_date ? formatDate(data.employee.joining_date) : '—'}</td></tr>
          <tr><td className="py-1 text-gray-500">Reason for Relieving</td><td className="py-1 font-medium">{data.reason}</td></tr>
          <tr><td className="py-1 text-gray-500">Date of Resignation</td><td className="py-1 font-medium">{formatDate(data.resignationDetails.submittedDate)}</td></tr>
          <tr><td className="py-1 text-gray-500">Date of Relieving</td><td className="py-1 font-medium">{formatDate(data.resignationDetails.approvedLastWorkingDate)}</td></tr>
          <tr><td className="py-1 text-gray-500">Notice Period</td><td className="py-1 font-medium">{data.resignationDetails.noticePeriod} days</td></tr>
          <tr><td className="py-1 text-gray-500">Working Days Settled</td><td className="py-1 font-medium">{data.workingDaysSettled}</td></tr>
          <tr><td className="py-1 text-gray-500">Leave Balance</td><td className="py-1 font-medium">{data.leaveBalance}</td></tr>
        </tbody>
      </table>

      <h2 className="font-semibold text-sm mb-2 border-b border-gray-300 pb-1">Full &amp; Final Calculation</h2>
      <div className="grid grid-cols-2 gap-6 text-sm mb-4">
        <div>
          <p className="font-medium text-gray-700 mb-1">Earnings</p>
          {data.additions.length === 0 && <p className="text-gray-400 text-xs">None</p>}
          {data.additions.map((l, i) => (
            <div key={i} className="flex justify-between"><span>{l.salary_head_item_desc}</span><span>{Number(l.salary_amount).toFixed(2)}</span></div>
          ))}
        </div>
        <div>
          <p className="font-medium text-gray-700 mb-1">Deductions</p>
          {data.deductions.length === 0 && <p className="text-gray-400 text-xs">None</p>}
          {data.deductions.map((l, i) => (
            <div key={i} className="flex justify-between"><span>{l.salary_head_item_desc}</span><span>{Number(l.salary_amount).toFixed(2)}</span></div>
          ))}
          <div className="flex justify-between pt-1 border-t border-gray-200 mt-1">
            <span>Notice Pay (shortfall, informational)</span><span>{data.noticePay.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-between text-base font-semibold border-t border-gray-300 pt-2">
        <span>Net Payable</span>
        <span>{data.netSalary.toFixed(2)}</span>
      </div>

      <p className="text-xs text-gray-400 text-center mt-8">This is a system generated statement which does not require signature.</p>
    </div>
  );
}
