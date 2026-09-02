'use client';

import { useQuery } from '@tanstack/react-query';
import { X, Download } from 'lucide-react';
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

// Mirrors legacy's View Slip button (showprocesspayrolltab.ctp / showapprovepayrolltab.ctp
// formatter="viewSalarySlip"): an in-place modal calling PayrollController::showsalaryslip()
// (https://in.mypayrollmaster.online/payroll/showsalaryslip/<id>), not a page navigation.
export function SalarySlipModal({ payrollMasterPkey, onClose }: { payrollMasterPkey: number; onClose: () => void }) {
  const { data, isLoading, error } = useQuery<SlipResponse>({
    queryKey: ['payroll/slip', payrollMasterPkey],
    queryFn: async () => {
      const res = await fetch(`/api/payroll/slip/${payrollMasterPkey}`);
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Failed to load slip');
      return b;
    },
  });

  const { data: company } = useQuery<CompanyInfo>({
    queryKey: ['company'],
    queryFn: () => fetch('/api/company').then((r) => r.json()),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
          <div className="min-w-0">
            <h2 className="font-heading text-[15px] font-bold text-[#0F172A] truncate">
              {data ? `${data.header.emp_name}'s Payslip` : 'Payslip'}
            </h2>
            {data && (
              <p className="text-[11.5px] text-[#64748B] mt-0.5">
                {data.header.month_year} &middot; {data.header.branch_code} &middot; Status: {data.header.action ?? 'Draft'}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {data && (
              <button
                onClick={() => generatePayslipPdf(data.header, data.direct, data.indirect, company ?? null)}
                className="inline-flex items-center gap-1.5 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download PDF
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-6 py-4">
          {isLoading && <div className="text-slate-500 text-sm">Loading...</div>}
          {error && <div className="text-[color:var(--color-danger)] text-sm">{(error as Error).message}</div>}

          {data && (
            <>
              <div className="grid grid-cols-3 gap-4 text-[12.5px] mb-4">
                <div><span className="text-slate-500">Present days:</span> {data.header.days_presant ?? '-'}</div>
                <div><span className="text-slate-500">Leave days:</span> {data.header.days_leave ?? '-'}</div>
                <div><span className="text-slate-500">LOP:</span> {data.header.loss_of_pay ?? '-'}</div>
              </div>

              <h3 className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide mb-3">Earnings &amp; Deductions</h3>
              {data.direct.length === 0 && (
                <div className="text-slate-400 text-[13px] mb-4">No components yet — process payroll first.</div>
              )}
              {data.direct.map((group) => (
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

              <div className="flex justify-between pt-3 border-t border-slate-200 text-[15px] font-semibold text-[#0F172A] mb-4">
                <span>Net Salary</span>
                <span>{data.header.net_salary != null ? formatCurrency(data.header.net_salary) : '-'}</span>
              </div>

              {data.indirect.length > 0 && (
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide mb-3">Employer Contributions</h3>
                  {data.indirect.map((group) => (
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
