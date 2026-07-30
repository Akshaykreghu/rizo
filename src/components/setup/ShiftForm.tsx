'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';

type FormState = Record<string, string>;

interface ExceptionRow {
  ex_week_day: string;
  ex_week: string;
  week_off: string;
  in_time: string;
  out_time: string;
  duration: string;
  full_day: string;
  half_day: string;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULTS: FormState = {
  day_time_desc: '',
  active: '1', isnextday: '0', is_exception: '0',
  ot_eligibility_threshold: 'Y', strict_monitorings: 'N', is_multiple_days: 'N',
  include_break: 'N', first_in_last_punch: 'N',
  working_time3_ex_day: 'N', working_time4_ex_day: 'N', working_time5_ex_day: 'N', working_time6_ex_day: 'N',
  max_out_before_next_in: 'Y', overtime_monitoring: 'Y',
  shift_allowance: '', otcomponents: '107',
  start_date_effective: '', end_date_effective: '',
  minuts_calc_perday: '0', minuts_aftr_on_dutty_cal_late: '0', minuts_bfr_off_dutty_cal_early: '0',
  min_cal_late_ifnoclockin: '0', min_cal_leave_early_ifnoclockout: '0',
  min_aftr_off_dutty_cal_ot: '0', min_bfr_on_dutty_cal_ot: '0', work_time_day_off_cal_ot: '0',
  minutes_per_half: '0', no_of_shift_days: '0',
  max_in_time: '', max_out_time: '',
  on_dutty1: '', off_dutty1: '', working_time1: '0',
  on_dutty2: '', off_dutty2: '', working_time2: '0',
  on_dutty3: '', off_dutty3: '', working_time3: '',
  on_dutty4: '', off_dutty4: '', working_time4: '',
  on_dutty5: '', off_dutty5: '', working_time5: '',
  on_dutty6: '', off_dutty6: '', working_time6: '',
};

WEEKDAYS.forEach((d) => {
  DEFAULTS[d] = 'N';
  DEFAULTS[`${d}_F`] = 'N';
});

export function ShiftForm({ id }: { id?: string }) {
  const router = useRouter();
  const isNew = !id;
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery<Record<string, unknown> | undefined>({
    queryKey: ['setup/shifts', id],
    queryFn: () => fetch(`/api/setup/shifts/${id}`).then((r) => r.json()),
    enabled: !isNew,
  });

  useEffect(() => {
    if (!data) return;
    const f: FormState = { ...DEFAULTS };
    Object.keys(DEFAULTS).forEach((key) => {
      const raw = data[key];
      if (raw !== null && raw !== undefined) f[key] = String(raw);
    });
    setForm(f);
    if (Array.isArray(data.exceptions)) {
      setExceptions(
        (data.exceptions as Record<string, unknown>[]).map((e) => ({
          ex_week_day: String(e.ex_week_day ?? ''),
          ex_week: String(e.ex_week ?? ''),
          week_off: String(e.week_off ?? 'N'),
          in_time: String(e.in_time ?? ''),
          out_time: String(e.out_time ?? ''),
          duration: e.duration != null ? String(e.duration) : '',
          full_day: e.full_day != null ? String(e.full_day) : '',
          half_day: e.half_day != null ? String(e.half_day) : '',
        }))
      );
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const url = isNew ? '/api/setup/shifts' : `/api/setup/shifts/${id}`;
      const method = isNew ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, exceptions }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      return res.json();
    },
    onSuccess: () => router.push('/setup/shifts'),
    onError: (e) => setError(String((e as Error).message)),
  });

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function text(key: string, label: string, type: 'text' | 'number' | 'date' = 'text', required = false) {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
        <input
          type={type}
          required={required}
          value={form[key] ?? ''}
          onChange={(e) => set(key, e.target.value)}
          className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
    );
  }

  function checkbox(key: string, label: string, yesVal = 'Y', noVal = 'N') {
    return (
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={form[key] === yesVal}
          onChange={(e) => set(key, e.target.checked ? yesVal : noVal)}
          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        {label}
      </label>
    );
  }

  function addException() {
    setExceptions((rows) => [
      ...rows,
      { ex_week_day: 'Saturday', ex_week: '1', week_off: 'Y', in_time: '', out_time: '', duration: '', full_day: '', half_day: '' },
    ]);
  }

  function updateException(i: number, key: keyof ExceptionRow, value: string) {
    setExceptions((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }

  function removeException(i: number) {
    setExceptions((rows) => rows.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">
        {isNew ? 'New Shift' : 'Edit Shift'}
      </h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-6 max-w-4xl"
      >
        {/* Basic */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">Basic</h2>
          <div className="grid grid-cols-2 gap-4">
            {text('day_time_desc', 'Shift Name *', 'text', true)}
            <div className="flex items-end gap-4">
              {checkbox('active', 'Active', '1', '0')}
              {checkbox('isnextday', 'Next Day Shift', '1', '0')}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {text('start_date_effective', 'Effective Start', 'date')}
            {text('end_date_effective', 'Effective End', 'date')}
          </div>
        </section>

        {/* Weekday grid */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Weekly Working Days</h2>
          <div className="grid grid-cols-7 gap-3 text-center">
            {WEEKDAYS.map((d) => (
              <div key={d}>
                <div className="text-xs text-gray-500 mb-1">{d.slice(0, 3)}</div>
                <div className="space-y-1">
                  {checkbox(d, 'Work')}
                  {checkbox(`${d}_F`, 'Alt')}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Duty windows */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Duty Windows</h2>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="grid grid-cols-3 gap-4">
              {text(`on_dutty${n}`, `On Duty ${n} (HH:MM:SS)`)}
              {text(`off_dutty${n}`, `Off Duty ${n} (HH:MM:SS)`)}
              {text(`working_time${n}`, `Working Minutes ${n}`)}
            </div>
          ))}
        </section>

        {/* Calculation rules */}
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">Calculation Rules</h2>
          <div className="grid grid-cols-3 gap-4">
            {text('minuts_calc_perday', 'Minutes/Day', 'number')}
            {text('minutes_per_half', 'Minutes/Half Day', 'number')}
            {text('no_of_shift_days', 'No. of Shift Days', 'number')}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {text('minuts_aftr_on_dutty_cal_late', 'Grace Mins After On-Duty (Late)', 'number')}
            {text('minuts_bfr_off_dutty_cal_early', 'Grace Mins Before Off-Duty (Early)', 'number')}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {text('min_cal_late_ifnoclockin', 'Mins Late If No Clock-In', 'number')}
            {text('min_cal_leave_early_ifnoclockout', 'Mins Early Leave If No Clock-Out', 'number')}
          </div>
          <div className="grid grid-cols-3 gap-4">
            {text('min_aftr_off_dutty_cal_ot', 'OT Mins After Off-Duty', 'number')}
            {text('min_bfr_on_dutty_cal_ot', 'OT Mins Before On-Duty', 'number')}
            {text('work_time_day_off_cal_ot', 'OT Mins on Day Off', 'number')}
          </div>
          <div className="grid grid-cols-3 gap-4">
            {text('shift_allowance', 'Shift Allowance')}
            {text('otcomponents', 'OT Component Code')}
            {checkbox('ot_eligibility_threshold', 'OT Eligible')}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {text('max_in_time', 'Max In Time (mins)', 'number')}
            {text('max_out_time', 'Max Out Time (mins)', 'number')}
          </div>
        </section>

        {/* Flags */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Flags</h2>
          <div className="grid grid-cols-3 gap-3">
            {checkbox('strict_monitorings', 'Strict Monitoring')}
            {checkbox('is_multiple_days', 'Multiple Days Shift')}
            {checkbox('include_break', 'Include Break')}
            {checkbox('first_in_last_punch', 'First-In / Last-Punch')}
            {checkbox('max_out_before_next_in', 'Max Out Before Next In')}
            {checkbox('overtime_monitoring', 'Overtime Monitoring')}
            {checkbox('working_time3_ex_day', 'Working Time 3 Exception Day')}
            {checkbox('working_time4_ex_day', 'Working Time 4 Exception Day')}
            {checkbox('working_time5_ex_day', 'Working Time 5 Exception Day')}
            {checkbox('working_time6_ex_day', 'Working Time 6 Exception Day')}
            {checkbox('is_exception', 'Has Weekday Exceptions', '1', '0')}
          </div>
        </section>

        {/* Exceptions */}
        {form.is_exception === '1' && (
          <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Weekday Exceptions</h2>
              <button
                type="button"
                onClick={addException}
                className="text-xs text-indigo-600 hover:underline"
              >
                + Add Exception
              </button>
            </div>
            {exceptions.length === 0 && (
              <p className="text-xs text-gray-400">No exceptions added.</p>
            )}
            {exceptions.map((ex, i) => (
              <div key={i} className="grid grid-cols-8 gap-2 items-end border-t border-gray-100 pt-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Weekday</label>
                  <select
                    value={ex.ex_week_day}
                    onChange={(e) => updateException(i, 'ex_week_day', e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                  >
                    {WEEKDAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Occurrence</label>
                  <input
                    value={ex.ex_week}
                    onChange={(e) => updateException(i, 'ex_week', e.target.value)}
                    placeholder="1st/3rd"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <label className="flex items-center gap-1 text-xs text-gray-700 pb-2">
                  <input
                    type="checkbox"
                    checked={ex.week_off === 'Y'}
                    onChange={(e) => updateException(i, 'week_off', e.target.checked ? 'Y' : 'N')}
                    className="rounded border-gray-300 text-indigo-600"
                  />
                  Week Off
                </label>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">In Time</label>
                  <input
                    type="time"
                    value={ex.in_time}
                    onChange={(e) => updateException(i, 'in_time', e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Out Time</label>
                  <input
                    type="time"
                    value={ex.out_time}
                    onChange={(e) => updateException(i, 'out_time', e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Duration</label>
                  <input
                    type="number"
                    value={ex.duration}
                    onChange={(e) => updateException(i, 'duration', e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Full Day</label>
                  <input
                    type="number"
                    value={ex.full_day}
                    onChange={(e) => updateException(i, 'full_day', e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeException(i)}
                  className="text-xs text-red-600 hover:underline pb-2"
                >
                  Remove
                </button>
              </div>
            ))}
          </section>
        )}

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex items-center gap-4 pb-10">
          <button
            type="submit"
            disabled={save.isPending}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {save.isPending ? 'Saving…' : 'Save Shift'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/setup/shifts')}
            className="text-sm text-gray-600 hover:underline"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
