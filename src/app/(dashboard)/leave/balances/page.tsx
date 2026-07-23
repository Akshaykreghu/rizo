'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';

interface BalanceRow {
  salaryHeadItemFkey: number;
  name: string;
  allowNegative: boolean;
  isLeaveEncash: boolean;
  balance: number;
}

export default function LeaveBalancesPage() {
  const [employee, setEmployee] = useState('');

  const { data, isLoading } = useQuery<{ data: BalanceRow[] }>({
    queryKey: ['leave', 'balances', employee],
    queryFn: () => fetch(`/api/leave/balances?employee=${employee}`).then((r) => r.json()),
    enabled: !!employee,
  });
  const rows = data?.data ?? [];

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Leave Balances</h1>

      <div className="w-64 mb-4">
        <label className="block text-xs text-gray-500 mb-1">Employee</label>
        <EmployeeSearch value={employee} onChange={setEmployee} />
      </div>

      {!employee && <p className="text-sm text-gray-400">Select an employee to view balances.</p>}
      {employee && isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {employee && !isLoading && rows.length === 0 && <p className="text-sm text-gray-400">No leave policy assigned for this employee.</p>}

      {rows.length > 0 && (
        <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden max-w-2xl">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="p-2">Leave Type</th>
              <th className="p-2">Balance</th>
              <th className="p-2">Encashable</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.salaryHeadItemFkey} className="border-t border-gray-100">
                <td className="p-2">{r.name}</td>
                <td className={`p-2 font-medium ${r.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>{r.balance}</td>
                <td className="p-2">{r.isLeaveEncash ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
