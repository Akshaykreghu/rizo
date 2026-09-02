'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

interface MonthCount { month_year: string; days: number }

interface CompOffData {
  employee: { name: string; empId: string | null; designation: string | null; department: string | null; branch: string | null; joiningDate: string | null };
  used: MonthCount[];
  earned: MonthCount[];
  totalUsed: number;
  totalEarned: number;
  balance: number;
}

export default function CompOffPage() {
  const { slotEl } = useHeaderSlot();
  const [empFkey, setEmpFkey] = useState('');

  const { data, isLoading, error } = useQuery<CompOffData>({
    queryKey: ['comp-off', empFkey],
    queryFn: () => fetch(`/api/attendance/comp-off?empFkey=${empFkey}`).then(async (r) => {
      if (!r.ok) throw new Error((await r.json()).error ?? 'Failed to load');
      return r.json();
    }),
    enabled: !!empFkey,
  });

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Comp Off
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Compensatory-off earned and used, by employee
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 w-72">
        <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
        <EmployeeSearch value={empFkey} onChange={setEmpFkey} />
      </div>

      {!empFkey && <p className="text-[12.5px] text-slate-400">Select an employee to view their comp-off report.</p>}
      {empFkey && isLoading && <p className="text-[12.5px] text-slate-400">Loading…</p>}
      {empFkey && error && <p className="text-[12.5px] text-[color:var(--color-danger)]">{String((error as Error).message)}</p>}

      {data && (
        <div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="glass-card rounded-2xl p-4">
              <p className="text-slate-400 text-[11px] mb-1">Employee</p>
              <p className="text-sm font-medium text-[#0F172A]">{data.employee.name} <span className="text-slate-400">({data.employee.empId})</span></p>
              <p className="text-[12.5px] text-slate-500">{data.employee.designation} · {data.employee.department}</p>
              <p className="text-[12.5px] text-slate-500">{data.employee.branch}</p>
            </div>
            <div className="glass-card rounded-2xl p-4">
              <p className="text-slate-400 text-[11px] mb-1">Balance (Earned − Used)</p>
              <p className="text-2xl font-semibold text-[#0F172A]">{data.balance}</p>
              <p className="text-slate-500 text-[11.5px]">Earned {data.totalEarned} · Used {data.totalUsed}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="glass-card rounded-2xl p-4">
              <h2 className="text-[13.5px] font-semibold text-slate-600 uppercase tracking-wide mb-3">Used</h2>
              <table className="w-full text-[13px]">
                <thead><tr className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide"><th className="pb-1.5">Month</th><th className="pb-1.5">Days</th></tr></thead>
                <tbody>
                  {data.used.length === 0 && <tr><td colSpan={2} className="py-1.5 text-slate-400 text-[12px]">None</td></tr>}
                  {data.used.map((r) => (
                    <tr key={r.month_year} className="border-t border-slate-100"><td className="py-1.5 text-[#0F172A]">{r.month_year}</td><td className="py-1.5 text-[#0F172A]">{r.days}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="glass-card rounded-2xl p-4">
              <h2 className="text-[13.5px] font-semibold text-slate-600 uppercase tracking-wide mb-3">Earned</h2>
              <table className="w-full text-[13px]">
                <thead><tr className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide"><th className="pb-1.5">Month</th><th className="pb-1.5">Days</th></tr></thead>
                <tbody>
                  {data.earned.length === 0 && <tr><td colSpan={2} className="py-1.5 text-slate-400 text-[12px]">None</td></tr>}
                  {data.earned.map((r) => (
                    <tr key={r.month_year} className="border-t border-slate-100"><td className="py-1.5 text-[#0F172A]">{r.month_year}</td><td className="py-1.5 text-[#0F172A]">{r.days}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
