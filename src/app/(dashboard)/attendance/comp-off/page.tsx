'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';

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
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Comp Off</h1>

      <div className="w-72 mb-6">
        <label className="block text-xs text-gray-500 mb-1">Employee</label>
        <EmployeeSearch value={empFkey} onChange={setEmpFkey} />
      </div>

      {!empFkey && <p className="text-sm text-gray-400">Select an employee to view their comp-off report.</p>}
      {empFkey && isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {empFkey && error && <p className="text-sm text-red-600">{String((error as Error).message)}</p>}

      {data && (
        <div>
          <div className="grid grid-cols-2 gap-6 mb-6 text-sm">
            <div className="border border-gray-200 rounded-lg p-4">
              <p className="text-gray-400 text-xs mb-1">Employee</p>
              <p className="font-medium">{data.employee.name} <span className="text-gray-400">({data.employee.empId})</span></p>
              <p className="text-gray-500">{data.employee.designation} · {data.employee.department}</p>
              <p className="text-gray-500">{data.employee.branch}</p>
            </div>
            <div className="border border-gray-200 rounded-lg p-4">
              <p className="text-gray-400 text-xs mb-1">Balance (Earned − Used)</p>
              <p className="text-2xl font-semibold">{data.balance}</p>
              <p className="text-gray-500 text-xs">Earned {data.totalEarned} · Used {data.totalUsed}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <h2 className="font-semibold text-sm mb-2">Used</h2>
              <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
                <thead><tr className="bg-gray-50 text-left"><th className="p-2">Month</th><th className="p-2">Days</th></tr></thead>
                <tbody>
                  {data.used.length === 0 && <tr><td colSpan={2} className="p-2 text-gray-400 text-xs">None</td></tr>}
                  {data.used.map((r) => (
                    <tr key={r.month_year} className="border-t border-gray-100"><td className="p-2">{r.month_year}</td><td className="p-2">{r.days}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h2 className="font-semibold text-sm mb-2">Earned</h2>
              <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
                <thead><tr className="bg-gray-50 text-left"><th className="p-2">Month</th><th className="p-2">Days</th></tr></thead>
                <tbody>
                  {data.earned.length === 0 && <tr><td colSpan={2} className="p-2 text-gray-400 text-xs">None</td></tr>}
                  {data.earned.map((r) => (
                    <tr key={r.month_year} className="border-t border-gray-100"><td className="p-2">{r.month_year}</td><td className="p-2">{r.days}</td></tr>
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
