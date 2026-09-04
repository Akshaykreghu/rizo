'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useSetupOptions } from '@/lib/setupOptions';
import type { ColumnDef } from '@tanstack/react-table';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

const useLookup = useSetupOptions;

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

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

interface DailyRow { first_name: string; last_name: string; emp_id: string; att_date: string; att_in_time: string | null; att_out_time: string | null; duration: number | null }
interface MinuteRow { emp_pkey: number; EmpName: string; LogDate: string; Location: string | null; minutes: string | null }

export default function CheckinReportsPage() {
  const { slotEl } = useHeaderSlot();
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

  const dailyColumns: ColumnDef<DailyRow, unknown>[] = [
    { id: 'employee', header: 'Employee', cell: ({ row }) => <>{row.original.first_name} {row.original.last_name} <span className="text-slate-400 text-[11px]">({row.original.emp_id})</span></> },
    { id: 'date', header: 'Date', cell: ({ row }) => row.original.att_date?.slice(0, 10) },
    { id: 'in', header: 'In Time', cell: ({ row }) => row.original.att_in_time ? new Date(row.original.att_in_time).toLocaleTimeString() : '—' },
    { id: 'out', header: 'Out Time', cell: ({ row }) => row.original.att_out_time ? new Date(row.original.att_out_time).toLocaleTimeString() : '—' },
    { id: 'duration', header: 'Duration (min)', cell: ({ row }) => row.original.duration ?? '—' },
  ];

  const minuteColumns: ColumnDef<MinuteRow, unknown>[] = [
    { accessorKey: 'EmpName', header: 'Employee' },
    { id: 'logDate', header: 'Log Date', cell: ({ row }) => new Date(row.original.LogDate).toLocaleString() },
    { id: 'location', header: 'Location', cell: ({ row }) => row.original.Location ?? '—' },
    { id: 'minutes', header: data?.label ?? 'Minutes', cell: ({ row }) => row.original.minutes ?? '—' },
  ];

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Check-in Reports
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Daily attendance and early/late in-out reports
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Report</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className={`${INPUT_CLASS} min-w-[160px]`}>
            {REPORT_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={INPUT_CLASS} />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className={`${INPUT_CLASS} min-w-[160px]`}>
            <option value="">All branches</option>
            {branches.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {isDaily ? (
        <DataTable data={rows as DailyRow[]} columns={dailyColumns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />
      ) : (
        <DataTable data={rows as MinuteRow[]} columns={minuteColumns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />
      )}
    </div>
  );
}
