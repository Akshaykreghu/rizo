'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { generatePayslipPdf } from '@/lib/payslipPdf';

interface SlipItem {
  salary_head_item_desc: string | null;
  head_operator: string | null;
  salary_amount: number | null;
  salary_rate: number | null;
  structure_det_value: number | null;
}
interface SlipGroup {
  head_pkey: number | null;
  head_desc: string;
  items: SlipItem[];
}
interface SlipResponse {
  header: {
    payroll_master_pkey: number;
    emp_name: string;
    branch_code: string;
    month_year: string;
    days_presant: number | null;
    days_leave: number | null;
    loss_of_pay: number | null;
    gross_salary: number | null;
    net_salary: number | null;
    total_deduction: number | null;
    action: string | null;
    desig: string | null;
    departments: string | null;
    bank_details: string | null;
    emp_status: number | null;
  };
  direct: SlipGroup[];
  indirect: SlipGroup[];
}
interface CompanyInfo {
  business_name?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
}

function groupTotal(group: SlipGroup) {
  return group.items.reduce((sum, i) => sum + (Number(i.salary_amount) || 0), 0);
}

export default function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data, isLoading, error } = useQuery<SlipResponse>({
    queryKey: ['payroll/slip', id],
    queryFn: async () => {
      const res = await fetch(`/api/payroll/slip/${id}`);
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Failed to load slip');
      return b;
    },
  });

  const { data: company } = useQuery<CompanyInfo>({
    queryKey: ['company'],
    queryFn: () => fetch('/api/company').then((r) => r.json()),
  });

  if (isLoading) return <div className="text-gray-500 text-sm">Loading...</div>;
  if (error) return <div className="text-red-600 text-sm">{(error as Error).message}</div>;
  if (!data) return null;

  const { header, direct, indirect } = data;

  return (
    <div className="max-w-3xl">
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{header.emp_name}&apos;s Payslip</h1>
            <p className="text-sm text-gray-500">
              {header.month_year} &middot; {header.branch_code} &middot; Status: {header.action ?? 'Draft'}
            </p>
          </div>
          <button
            onClick={() => generatePayslipPdf(header, direct, indirect, company ?? null)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            Download PDF
          </button>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
          <div><span className="text-gray-500">Present days:</span> {header.days_presant ?? '-'}</div>
          <div><span className="text-gray-500">Leave days:</span> {header.days_leave ?? '-'}</div>
          <div><span className="text-gray-500">LOP:</span> {header.loss_of_pay ?? '-'}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Earnings &amp; Deductions</h2>
        {direct.length === 0 && <div className="text-gray-400 text-sm">No components yet — process payroll first.</div>}
        {direct.map((group) => (
          <div key={group.head_pkey ?? group.head_desc} className="mb-4">
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">{group.head_desc || 'Other'}</div>
            <table className="w-full text-sm">
              <tbody>
                {group.items.map((item, idx) => (
                  <tr key={idx} className="border-t border-gray-100">
                    <td className="py-1.5 text-gray-700">{item.salary_head_item_desc}</td>
                    <td className={`py-1.5 text-right ${item.head_operator === 'Deduction' ? 'text-red-600' : 'text-gray-800'}`}>
                      {formatCurrency(Number(item.salary_amount) || 0)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-gray-200 font-medium">
                  <td className="py-1.5 text-gray-700">Subtotal</td>
                  <td className="py-1.5 text-right text-gray-900">{formatCurrency(groupTotal(group))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}

        <div className="flex justify-between pt-3 border-t border-gray-200 text-base font-semibold">
          <span>Net Salary</span>
          <span>{header.net_salary != null ? formatCurrency(header.net_salary) : '-'}</span>
        </div>
      </div>

      {indirect.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Employer Contributions</h2>
          {indirect.map((group) => (
            <div key={group.head_pkey ?? group.head_desc} className="mb-2">
              <div className="text-xs font-semibold text-gray-500 uppercase mb-1">{group.head_desc || 'Other'}</div>
              <table className="w-full text-sm">
                <tbody>
                  {group.items.map((item, idx) => (
                    <tr key={idx} className="border-t border-gray-100">
                      <td className="py-1.5 text-gray-700">{item.salary_head_item_desc}</td>
                      <td className="py-1.5 text-right text-gray-800">{formatCurrency(Number(item.salary_amount) || 0)}</td>
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
