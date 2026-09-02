'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { Save } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

interface ShiftOption {
  dayTimeSeq: number;
  label: string;
  onDuty: string;
  offDuty: string;
  minutesPerDay: number;
}

interface DayRow {
  date: string;
  shiftId: number | null;
}

export default function ShiftPlannerPage() {
  const { slotEl } = useHeaderSlot();
  const [empFkey, setEmpFkey] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [changes, setChanges] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<{ shiftOptions: ShiftOption[]; days: DayRow[]; locked: boolean }>({
    queryKey: ['shift-planner', empFkey, month],
    queryFn: () => fetch(`/api/attendance/shift-planner?empFkey=${empFkey}&month=${month}`).then((r) => r.json()),
    enabled: !!empFkey,
  });

  const save = useMutation({
    mutationFn: () =>
      fetch('/api/attendance/shift-planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empFkey: Number(empFkey), month, shifts: changes }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to save roster');
        return body;
      }),
    onSuccess: () => {
      setMessage('Roster saved');
      setChanges({});
      refetch();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const days = data?.days ?? [];
  const shiftOptions = data?.shiftOptions ?? [];

  const columns: ColumnDef<DayRow, unknown>[] = [
    { accessorKey: 'date', header: 'Date' },
    {
      id: 'shift',
      header: 'Shift',
      cell: ({ row }) => {
        const currentShiftId = changes[row.original.date] ?? row.original.shiftId;
        return (
          <select
            value={currentShiftId ?? ''}
            disabled={data?.locked}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setChanges((prev) => ({ ...prev, [row.original.date]: Number(e.target.value) }))}
            className={INPUT_CLASS}
          >
            {shiftOptions.map((s) => (
              <option key={s.dayTimeSeq} value={s.dayTimeSeq}>{s.label}{s.dayTimeSeq === shiftOptions[0]?.dayTimeSeq ? ' (Primary)' : ''}</option>
            ))}
          </select>
        );
      },
    },
    {
      id: 'timings',
      header: 'Shift Timings',
      cell: ({ row }) => {
        const currentShiftId = changes[row.original.date] ?? row.original.shiftId;
        const shift = shiftOptions.find((s) => s.dayTimeSeq === currentShiftId);
        return <span className="text-slate-500">{shift ? `${shift.onDuty} - ${shift.offDuty}` : ''}</span>;
      },
    },
  ];

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Shift Planner
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Plan and adjust an employee&apos;s daily shift roster
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
          <EmployeeSearch value={empFkey} onChange={setEmpFkey} />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={INPUT_CLASS} />
        </div>
        <button
          onClick={() => save.mutate()}
          disabled={!empFkey || Object.keys(changes).length === 0 || save.isPending || data?.locked}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Save className="w-3.5 h-3.5" /> Save Roster
        </button>
        {message && <span className="text-[12.5px] text-slate-500">{message}</span>}
      </div>

      {data?.locked && (
        <div className="mb-4 text-[12.5px] bg-[color:var(--color-highlight-light)] text-[color:var(--color-highlight-dark)] px-3.5 py-2 rounded-lg">
          Attendance already verified for this month — roster changes are locked. Un-verify attendance first to make changes.
        </div>
      )}

      {!empFkey ? (
        <p className="text-[12.5px] text-slate-400">Select an employee to view their roster.</p>
      ) : (
        <DataTable
          data={days}
          columns={columns}
          pageSize={31}
          isLoading={isLoading}
          isRowSelected={(row) => (changes[row.date] ?? row.shiftId) !== row.shiftId}
        />
      )}
    </div>
  );
}
