'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

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

const TABS = [
  { key: 'not-approved', label: 'Not Approved' },
  { key: 'approved', label: 'Approved' },
] as const;

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

interface OtRow {
  empOtMasterPkey: number;
  empFkey: number;
  empName: string;
  totalDurationMin: number;
  setDurationMin: number;
  isVerified: boolean;
}

export default function OvertimePage() {
  const { slotEl } = useHeaderSlot();
  const [month, setMonth] = useState(currentMonth());
  const [branch, setBranch] = useState('');
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('not-approved');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  const [message, setMessage] = useState<string | null>(null);

  const { data: branches = [] } = useLookup('setup/branches', 'branch_code', (r) => String(r.branch_name));

  const { data, isLoading, refetch } = useQuery<{ data: OtRow[] }>({
    queryKey: ['attendance-overtime', month, branch, tab],
    queryFn: () => fetch(`/api/attendance/overtime?month=${month}&branch=${branch}&tab=${tab}`).then((r) => r.json()),
    enabled: !!branch,
  });

  const rows = data?.data ?? [];

  const approve = useMutation({
    mutationFn: () =>
      fetch('/api/attendance/overtime/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month,
          employees: Array.from(selected).map((empFkey) => ({
            emp_fkey: empFkey,
            set_duration_min: overrides[empFkey],
          })),
        }),
      }).then((r) => r.json()),
    onSuccess: () => {
      setMessage(`Approved ${selected.size} employee(s)`);
      setSelected(new Set());
      refetch();
    },
  });

  const toggle = (empFkey: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(empFkey)) next.delete(empFkey);
      else next.add(empFkey);
      return next;
    });
  };

  const columns: ColumnDef<OtRow, unknown>[] = [
    ...(tab === 'not-approved'
      ? [{
          id: 'select',
          header: '',
          meta: { className: 'w-10' },
          cell: ({ row }: { row: { original: OtRow } }) => (
            <input
              type="checkbox"
              checked={selected.has(row.original.empFkey)}
              onChange={(e) => { e.stopPropagation(); toggle(row.original.empFkey); }}
              onClick={(e) => e.stopPropagation()}
              className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40"
            />
          ),
        } as ColumnDef<OtRow, unknown>]
      : []),
    { accessorKey: 'empName', header: 'Employee', cell: ({ getValue }) => <span className="font-medium text-[#0F172A]">{String(getValue())}</span> },
    { id: 'totalHrs', header: 'Total Hrs Worked', cell: ({ row }) => (row.original.totalDurationMin / 60).toFixed(2) },
    { id: 'otHrs', header: 'OT (hrs)', cell: ({ row }) => (row.original.setDurationMin / 60).toFixed(2) },
    ...(tab === 'not-approved'
      ? [{
          id: 'setOt',
          header: 'Set New OT (mins)',
          cell: ({ row }: { row: { original: OtRow } }) => {
            const override = overrides[row.original.empFkey];
            return (
              <input
                type="number"
                min={0}
                max={44640}
                value={override ?? row.original.totalDurationMin}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = Math.min(44640, Math.max(0, Number(e.target.value) || 0));
                  setOverrides((prev) => ({ ...prev, [row.original.empFkey]: v }));
                }}
                className={cn(INPUT_CLASS, 'w-24')}
              />
            );
          },
        } as ColumnDef<OtRow, unknown>]
      : []),
    {
      id: 'newOt',
      header: 'New OT (hrs)',
      cell: ({ row }) => {
        const override = overrides[row.original.empFkey];
        const mins = override ?? row.original.totalDurationMin;
        return (mins / 60).toFixed(2);
      },
    },
  ];

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Overtime
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Review and approve overtime once attendance for the month is verified
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={INPUT_CLASS} />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className={cn(INPUT_CLASS, 'min-w-[180px]')}>
            <option value="">Select branch</option>
            {branches.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {tab === 'not-approved' && (
          <button
            onClick={() => approve.mutate()}
            disabled={selected.size === 0 || approve.isPending}
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Approve Selected
          </button>
        )}
        {message && <span className="text-[12.5px] text-slate-500">{message}</span>}
      </div>

      <div className="sticky top-0 z-20 glass-card-strong rounded-xl px-3 py-2 flex items-center mb-4">
        <div className="flex items-center gap-1 flex-wrap text-[12.5px] bg-slate-900/[0.03] rounded-lg p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSelected(new Set()); }}
              className={cn(
                'px-3 py-1 rounded-md transition-all duration-[180ms] font-medium border whitespace-nowrap',
                tab === t.key
                  ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] border-[color:var(--color-primary)]/30'
                  : 'bg-white text-slate-500 border-transparent hover:bg-white/70'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {!branch ? (
        <p className="text-[12.5px] text-slate-400 px-1">Select a branch to view overtime.</p>
      ) : (
        <DataTable data={rows} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />
      )}
    </div>
  );
}
