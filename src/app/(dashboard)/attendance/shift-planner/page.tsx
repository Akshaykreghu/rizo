'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { Save } from 'lucide-react';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

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

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Shift Planner</h1>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="w-72">
          <label className="block text-xs text-gray-500 mb-1">Employee</label>
          <EmployeeSearch value={empFkey} onChange={setEmpFkey} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <button
          onClick={() => save.mutate()}
          disabled={!empFkey || Object.keys(changes).length === 0 || save.isPending || data?.locked}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Save className="w-4 h-4" /> Save Roster
        </button>
      </div>

      {message && <div className="mb-4 text-sm bg-blue-50 text-blue-700 px-3 py-2 rounded-lg">{message}</div>}
      {data?.locked && (
        <div className="mb-4 text-sm bg-amber-50 text-amber-700 px-3 py-2 rounded-lg">
          Attendance already verified for this month — roster changes are locked. Un-verify attendance first to make changes.
        </div>
      )}

      {!empFkey && <p className="text-sm text-gray-400">Select an employee to view their roster.</p>}
      {empFkey && isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {empFkey && !isLoading && days.length > 0 && (
        <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="p-2">Date</th>
              <th className="p-2">Shift</th>
              <th className="p-2">Shift Timings</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const currentShiftId = changes[day.date] ?? day.shiftId;
              const shift = shiftOptions.find((s) => s.dayTimeSeq === currentShiftId);
              const isPrimary = day.shiftId === shiftOptions[0]?.dayTimeSeq;
              const changed = currentShiftId !== day.shiftId;
              return (
                <tr key={day.date} className={`border-t border-gray-100 ${changed ? 'bg-blue-50' : ''}`}>
                  <td className="p-2">{day.date}</td>
                  <td className="p-2">
                    <select
                      value={currentShiftId ?? ''}
                      disabled={data?.locked}
                      onChange={(e) => setChanges((prev) => ({ ...prev, [day.date]: Number(e.target.value) }))}
                      className="border border-gray-300 rounded px-2 py-1 text-sm"
                    >
                      {shiftOptions.map((s) => (
                        <option key={s.dayTimeSeq} value={s.dayTimeSeq}>{s.label}{s.dayTimeSeq === shiftOptions[0]?.dayTimeSeq ? ' (Primary)' : ''}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2 text-gray-500">{shift ? `${shift.onDuty} - ${shift.offDuty}` : isPrimary ? '' : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
