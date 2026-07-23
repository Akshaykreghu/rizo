'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

interface Option { value: string; label: string }

function useLookup(path: string, valueKey: string, labelFn: (r: Record<string, unknown>) => string) {
  return useQuery<Option[]>({
    queryKey: [path],
    queryFn: () => fetch(`/api/${path}`).then((r) => r.json()).then((rows: Record<string, unknown>[]) =>
      rows.map((r) => ({ value: String(r[valueKey]), label: labelFn(r) }))
    ),
  });
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const REPORT_TYPES = [
  { value: 'daily', label: 'Daily Attendance' },
  { value: 'early-in', label: 'Early In' },
  { value: 'early-out', label: 'Early Out' },
  { value: 'late-in', label: 'Late In' },
  { value: 'late-out', label: 'Late Out' },
];

interface DailyRow { first_name: string; last_name: string; emp_id: string; att_date: string; att_in_time: string | null; att_out_time: string | null; duration: number | null }
interface MinuteRow { emp_pkey: number; EmpName: string; LogDate: string; Location: string | null; minutes: string | null }

export default function CheckinReportsPage() {
  const [type, setType] = useState('daily');
  const [month, setMonth] = useState(currentMonth());
  const [branch, setBranch] = useState('');

  const { data: branches = [] } = useLookup('setup/branches', 'branch_code', (r) => String(r.branch_name));

  const { data, isLoading } = useQuery<{ data: (DailyRow | MinuteRow)[]; label?: string }>({
    queryKey: ['checkin-reports', type, month, branch],
    queryFn: () => fetch(`/api/attendance/checkin-reports?type=${type}&month=${month}&branch=${branch}`).then((r) => r.json()),
  });

  const rows = data?.data ?? [];
  const isDaily = type === 'daily';

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Check-in Reports</h1>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Report</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm min-w-[160px]">
            {REPORT_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Branch</label>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm min-w-[160px]">
            <option value="">All branches</option>
            {branches.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {!isLoading && rows.length === 0 && <p className="text-sm text-gray-400">No records found.</p>}

      {rows.length > 0 && isDaily && (
        <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="p-2">Employee</th>
              <th className="p-2">Date</th>
              <th className="p-2">In Time</th>
              <th className="p-2">Out Time</th>
              <th className="p-2">Duration (min)</th>
            </tr>
          </thead>
          <tbody>
            {(rows as DailyRow[]).map((r, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="p-2">{r.first_name} {r.last_name} <span className="text-gray-400 text-xs">({r.emp_id})</span></td>
                <td className="p-2">{r.att_date?.slice(0, 10)}</td>
                <td className="p-2">{r.att_in_time ? new Date(r.att_in_time).toLocaleTimeString() : '—'}</td>
                <td className="p-2">{r.att_out_time ? new Date(r.att_out_time).toLocaleTimeString() : '—'}</td>
                <td className="p-2">{r.duration ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rows.length > 0 && !isDaily && (
        <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="p-2">Employee</th>
              <th className="p-2">Log Date</th>
              <th className="p-2">Location</th>
              <th className="p-2">{data?.label ?? 'Minutes'}</th>
            </tr>
          </thead>
          <tbody>
            {(rows as MinuteRow[]).map((r, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="p-2">{r.EmpName}</td>
                <td className="p-2">{new Date(r.LogDate).toLocaleString()}</td>
                <td className="p-2">{r.Location ?? '—'}</td>
                <td className="p-2">{r.minutes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
