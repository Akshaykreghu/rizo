'use client';

import { use } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { generatePayslipPdf } from '@/lib/payslipPdf';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

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
  const { slotEl } = useHeaderSlot();

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

  if (isLoading) return <div className="text-slate-500 text-sm">Loading...</div>;
  if (error) return <div className="text-[color:var(--color-danger)] text-sm">{(error as Error).message}</div>;
  if (!data) return null;

  const { header, direct, indirect } = data;

  return (
    <div className="max-w-3xl">
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              {header.emp_name}&apos;s Payslip
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              {header.month_year} &middot; {header.branch_code} &middot; Status: {header.action ?? 'Draft'}
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="grid grid-cols-3 gap-4 text-[12.5px] flex-1">
            <div><span className="text-slate-500">Present days:</span> {header.days_presant ?? '-'}</div>
            <div><span className="text-slate-500">Leave days:</span> {header.days_leave ?? '-'}</div>
            <div><span className="text-slate-500">LOP:</span> {header.loss_of_pay ?? '-'}</div>
          </div>
          <button
            onClick={() => generatePayslipPdf(header, direct, indirect, company ?? null)}
            className="inline-flex items-center gap-1.5 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors flex-shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Download PDF
          </button>
        </div>
      </div>

      <div className="glass-card rounded-2xl p-6 mb-4">
        <h2 className="text-[13.5px] font-semibold text-slate-600 uppercase tracking-wide mb-4">Earnings &amp; Deductions</h2>
        {direct.length === 0 && <div className="text-slate-400 text-[13px]">No components yet — process payroll first.</div>}
        {direct.map((group) => (
          <div key={group.head_pkey ?? group.head_desc} className="mb-4">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{group.head_desc || 'Other'}</div>
            <table className="w-full text-[13px]">
              <tbody>
                {group.items.map((item, idx) => (
                  <tr key={idx} className="border-t border-slate-100">
                    <td className="py-1.5 text-[#0F172A]">{item.salary_head_item_desc}</td>
                    <td className={`py-1.5 text-right ${item.head_operator === 'Deduction' ? 'text-[color:var(--color-danger)]' : 'text-[#0F172A]'}`}>
                      {formatCurrency(Number(item.salary_amount) || 0)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200 font-medium">
                  <td className="py-1.5 text-[#0F172A]">Subtotal</td>
                  <td className="py-1.5 text-right text-[#0F172A]">{formatCurrency(groupTotal(group))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}

        <div className="flex justify-between pt-3 border-t border-slate-200 text-[15px] font-semibold text-[#0F172A]">
          <span>Net Salary</span>
          <span>{header.net_salary != null ? formatCurrency(header.net_salary) : '-'}</span>
        </div>
      </div>

      {indirect.length > 0 && (
        <div className="glass-card rounded-2xl p-6">
          <h2 className="text-[13.5px] font-semibold text-slate-600 uppercase tracking-wide mb-4">Employer Contributions</h2>
          {indirect.map((group) => (
            <div key={group.head_pkey ?? group.head_desc} className="mb-2">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{group.head_desc || 'Other'}</div>
              <table className="w-full text-[13px]">
                <tbody>
                  {group.items.map((item, idx) => (
                    <tr key={idx} className="border-t border-slate-100">
                      <td className="py-1.5 text-[#0F172A]">{item.salary_head_item_desc}</td>
                      <td className="py-1.5 text-right text-[#0F172A]">{formatCurrency(Number(item.salary_amount) || 0)}</td>
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
