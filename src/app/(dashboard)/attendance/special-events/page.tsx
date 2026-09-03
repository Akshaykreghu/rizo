'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EmployeeMultiSearch } from '@/components/employees/EmployeeMultiSearch';
import { Plus, X, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

// Ports ScheduledBreakOffController (legacy menu label: "Special Events Attendance") — override a
// date's computed attendance for specific employees: call people in on an off-day ("Attendance"),
// or force an off-day on what would otherwise be a working day ("Week Off"). See
// api/attendance/special-events/route.ts for the full behavior notes and legacy mapping.

interface Selected { empPkey: number; label: string }
interface SboRow { emp_fkey: number; first_half: 'Y' | 'N'; message: string | null; emp_id: string; first_name: string; last_name: string; branch_name: string | null }

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function SpecialEventsPage() {
  const { slotEl } = useHeaderSlot();
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [type, setType] = useState<'attendance' | 'weekoff'>('attendance');
  const [date, setDate] = useState('');
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [addSelection, setAddSelection] = useState<Selected[]>([]);
  const [addMessage, setAddMessage] = useState('');
  const [addFirstHalf, setAddFirstHalf] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: datesData } = useQuery<{ dates: string[] }>({
    queryKey: ['sbo-dates', month, type],
    queryFn: () => fetch(`/api/attendance/special-events/dates?month=${month}&scope=${type === 'attendance' ? 'off' : 'all'}`).then((r) => r.json()),
  });
  const dates = datesData?.dates ?? [];

  function resetSelectionOn<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDate('');
      setChecked(new Set());
    };
  }

  const { data: rowsData, isLoading, refetch } = useQuery<{ data: SboRow[] }>({
    queryKey: ['sbo-employees', date, type],
    queryFn: () => fetch(`/api/attendance/special-events?date=${date}&type=${type}`).then((r) => r.json()),
    enabled: !!date,
  });
  const rows = rowsData?.data ?? [];

  const add = useMutation({
    mutationFn: () =>
      fetch('/api/attendance/special-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empFkeys: addSelection.map((s) => s.empPkey),
          date, month, type, message: addMessage, firstHalf: addFirstHalf,
        }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to add employees');
        return body as { failed: { empFkey: number; reason: string }[] };
      }),
    onSuccess: (body) => {
      setShowAdd(false);
      setAddSelection([]);
      setAddMessage('');
      setAddFirstHalf(false);
      setNotice(body.failed.length ? `Added, but ${body.failed.length} employee(s) failed: ${body.failed[0].reason}` : 'Employees added');
      refetch();
      qc.invalidateQueries({ queryKey: ['sbo-dates'] });
    },
    onError: (err: Error) => setNotice(err.message),
  });

  const remove = useMutation({
    mutationFn: () =>
      fetch('/api/attendance/special-events', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empFkeys: Array.from(checked), date, month, type }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to remove employees');
        return body as { skipped: number[] };
      }),
    onSuccess: (body) => {
      setChecked(new Set());
      setNotice(body.skipped.length ? `Removed, but ${body.skipped.length} employee(s) skipped — attendance already verified for this month` : 'Employees removed');
      refetch();
    },
    onError: (err: Error) => setNotice(err.message),
  });

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Special Events Attendance
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Override attendance for specific employees on a date
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => resetSelectionOn(setMonth)(e.target.value)} className={INPUT_CLASS} />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Type</label>
          <select value={type} onChange={(e) => resetSelectionOn(setType)(e.target.value as 'attendance' | 'weekoff')} className={INPUT_CLASS}>
            <option value="attendance">Attendance (call in on an off day)</option>
            <option value="weekoff">Week Off (force an off day)</option>
          </select>
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Date</label>
          <select value={date} onChange={(e) => { setDate(e.target.value); setChecked(new Set()); }} className={cn(INPUT_CLASS, 'min-w-[150px]')}>
            <option value="">Select a date</option>
            {dates.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        {notice && <span className="text-[12.5px] text-slate-500">{notice}</span>}
      </div>

      {!date ? (
        <div className="surface-card rounded-xl px-4 py-6 text-center text-[12.5px] text-slate-400">
          Choose a date to view or add employees
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[12.5px] text-slate-500">{rows.length} employee(s) on {date}</div>
            <div className="flex items-center gap-2">
              {checked.size > 0 && (
                <button
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                  className={cn(BTN_BASE, 'bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger-dark)] hover:bg-[color:var(--color-danger)]/20')}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove ({checked.size})
                </button>
              )}
              <button
                onClick={() => setShowAdd(true)}
                className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
              >
                <Plus className="w-3.5 h-3.5" /> Add Employees
              </button>
            </div>
          </div>

          <div className="surface-card rounded-xl overflow-hidden">
            {isLoading ? (
              <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">No employees added for this date yet</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-slate-500">
                    <th className="px-4 py-2 w-8"></th>
                    <th className="px-4 py-2 font-medium">Employee</th>
                    <th className="px-4 py-2 font-medium">Branch</th>
                    {type === 'attendance' && <th className="px-4 py-2 font-medium">First Half Only</th>}
                    <th className="px-4 py-2 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.emp_fkey} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={checked.has(row.emp_fkey)}
                          onChange={(e) => setChecked((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(row.emp_fkey); else next.delete(row.emp_fkey);
                            return next;
                          })}
                        />
                      </td>
                      <td className="px-4 py-2">{row.first_name} {row.last_name} <span className="text-slate-400 text-[11px]">({row.emp_id})</span></td>
                      <td className="px-4 py-2">{row.branch_name}</td>
                      {type === 'attendance' && <td className="px-4 py-2">{row.first_half === 'Y' ? 'Yes' : 'No'}</td>}
                      <td className="px-4 py-2 text-slate-500">{row.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setShowAdd(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">Add Employees — {date}</h2>
              <button onClick={() => setShowAdd(false)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Employees</label>
                <EmployeeMultiSearch value={addSelection} onChange={setAddSelection} />
              </div>
              {type === 'attendance' && (
                <label className="flex items-center gap-2 text-[12.5px] text-slate-600">
                  <input type="checkbox" checked={addFirstHalf} onChange={(e) => setAddFirstHalf(e.target.checked)} />
                  First half only
                </label>
              )}
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Reason / Note</label>
                <input type="text" value={addMessage} onChange={(e) => setAddMessage(e.target.value)} placeholder="e.g. Annual Day event" className={cn(INPUT_CLASS, 'w-full')} />
              </div>
            </div>
            <button
              onClick={() => add.mutate()}
              disabled={addSelection.length === 0 || add.isPending}
              className={cn(BTN_BASE, 'w-full justify-center mt-4 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
            >
              {add.isPending ? 'Adding…' : `Add ${addSelection.length || ''} Employee(s)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
