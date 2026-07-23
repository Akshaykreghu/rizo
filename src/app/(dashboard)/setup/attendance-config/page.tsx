'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, useEffect } from 'react';

interface DbConfig {
  biometric_device_essl?: string;
  attendance_type?: string;
  attendance_format?: string;
  attendance_date?: number | string;
  emp_login?: string;
  payroll_type?: string;
  email_setup?: string;
  TDS_setup?: string;
  Salary_date?: number | string;
  active?: string;
  leave_url?: string;
  expense_url?: string;
  profile_url?: string;
  subdomain_url?: string;
}

export default function AttendanceConfigPage() {
  const [form, setForm] = useState<DbConfig>({});
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery<DbConfig | null>({
    queryKey: ['setup/attendance-config'],
    queryFn: () => fetch('/api/setup/attendance-config').then((r) => r.json()),
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      fetch('/api/setup/attendance-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  function text(key: keyof DbConfig, label: string) {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <input
          type="text"
          value={form[key] ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
    );
  }

  function checkbox(key: keyof DbConfig, label: string) {
    return (
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <input
          type="checkbox"
          checked={form[key] === 'Y'}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked ? 'Y' : 'N' }))}
          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        {label}
      </label>
    );
  }

  if (isLoading) return <div className="text-gray-500 text-sm">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Attendance Config</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="bg-white rounded-xl border border-gray-200 p-6 space-y-6 max-w-2xl"
      >
        <div className="border border-indigo-100 bg-indigo-50 rounded-lg p-4 space-y-3">
          <p className="text-xs text-indigo-700">
            These two fields drive the monthly attendance/payroll cycle date calculation
            (start &amp; end of period). Set carefully.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Attendance Format <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={form.attendance_format ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, attendance_format: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select…</option>
                <option value="A">A — offset from prior month</option>
                <option value="B">B — calendar month cutoff</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Attendance Date (0-31) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min={0}
                max={31}
                required
                value={form.attendance_date ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, attendance_date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {text('attendance_type', 'Attendance Type')}
          {text('payroll_type', 'Payroll Type')}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Salary Date</label>
          <input
            type="number"
            value={form.Salary_date ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, Salary_date: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {checkbox('biometric_device_essl', 'Biometric Device (eSSL)')}
          {checkbox('emp_login', 'Employee Login Enabled')}
          {checkbox('email_setup', 'Email Setup Enabled')}
          {checkbox('TDS_setup', 'TDS Setup Enabled')}
          {checkbox('active', 'Active')}
        </div>

        {text('leave_url', 'Leave Upload URL')}
        {text('expense_url', 'Expense URL')}
        {text('profile_url', 'Profile Image URL')}
        {text('subdomain_url', 'Subdomain Login URL')}

        {save.isError && (
          <p className="text-red-500 text-sm">{String(save.error)}</p>
        )}

        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={save.isPending}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {save.isPending ? 'Saving…' : 'Save Changes'}
          </button>
          {saved && <span className="text-green-600 text-sm">Saved successfully.</span>}
        </div>
      </form>
    </div>
  );
}
