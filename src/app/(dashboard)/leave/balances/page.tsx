'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

interface BalanceRow {
  salaryHeadItemFkey: number;
  name: string;
  allowNegative: boolean;
  isLeaveEncash: boolean;
  balance: number;
}

export default function LeaveBalancesPage() {
  const { slotEl } = useHeaderSlot();
  const [employee, setEmployee] = useState('');

  const { data, isLoading } = useQuery<{ data: BalanceRow[] }>({
    queryKey: ['leave', 'balances', employee],
    queryFn: () => fetch(`/api/leave/balances?employee=${employee}`).then((r) => r.json()),
    enabled: !!employee,
  });
  const rows = data?.data ?? [];

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Leave Balances
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Per-employee leave balance by leave type
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 w-64">
        <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
        <EmployeeSearch value={employee} onChange={setEmployee} />
      </div>

      {!employee && <p className="text-[12.5px] text-slate-400">Select an employee to view balances.</p>}
      {employee && isLoading && <p className="text-[12.5px] text-slate-400">Loading…</p>}
      {employee && !isLoading && rows.length === 0 && <p className="text-[12.5px] text-slate-400">No leave policy assigned for this employee.</p>}

      {rows.length > 0 && (
        <div className="glass-card rounded-2xl p-4 max-w-2xl">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                <th className="pb-1.5">Leave Type</th>
                <th className="pb-1.5">Balance</th>
                <th className="pb-1.5">Encashable</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.salaryHeadItemFkey} className="border-t border-slate-100">
                  <td className="py-1.5 text-[#0F172A]">{r.name}</td>
                  <td className={`py-1.5 font-medium ${r.balance < 0 ? 'text-[color:var(--color-danger)]' : 'text-[#0F172A]'}`}>{r.balance}</td>
                  <td className="py-1.5 text-[#0F172A]">{r.isLeaveEncash ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
