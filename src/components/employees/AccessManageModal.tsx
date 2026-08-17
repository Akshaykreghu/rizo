'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AccessData {
  emp_pkey: number;
  first_name: string;
  last_name: string | null;
  email: string | null;
  emp_company_id: string | null;
  user_id: string | null;
  access_allowed: string | null;
  locked: number | null;
  mobile_locked: string | null;
  punchtype: string | null;
}

const PUNCH_TYPES = [
  { value: 'W', label: 'Machine (Biometric/Device)' },
  { value: 'M', label: 'Mobile from anywhere' },
  { value: 'O', label: 'Mobile from office only' },
  { value: 'S', label: 'Web' },
];

const MIN_PASSWORD_LENGTH = 8;

const INPUT_CLASS = 'w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-[#0F172A] bg-white focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/40 focus:border-[color:var(--color-primary)]/40 transition-colors duration-[180ms]';
const LABEL_CLASS = 'block text-[13.5px] font-medium text-slate-600 mb-2';

interface AccessManageModalProps {
  empPkey: number;
  /** Called after a successful save, so the host can close the modal. */
  onSaved: () => void;
  /** Called for both save and reset-device outcomes, success or error, to surface a toast. */
  onNotify: (message: string, type: 'success' | 'error') => void;
}

export function AccessManageModal({ empPkey, onSaved, onNotify }: AccessManageModalProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});

  const { data, isLoading, isError } = useQuery<AccessData>({
    queryKey: ['employees/access', empPkey],
    queryFn: () => fetch(`/api/employees/access/${empPkey}`).then((r) => r.json()),
  });

  useEffect(() => {
    if (data) {
      setForm({
        user_id: data.user_id ?? '',
        email: data.email ?? '',
        access_allowed: data.access_allowed ?? 'N',
        locked: data.locked ? '1' : '0',
        mobile_allowed: data.mobile_locked === 'Y' ? 'N' : 'Y',
        punch_type: data.punchtype ?? 'W',
        new_password: '',
      });
    }
  }, [data]);

  const passwordTooShort = !!form.new_password && form.new_password.length < MIN_PASSWORD_LENGTH;

  const save = useMutation({
    mutationFn: () => fetch(`/api/employees/access/${empPkey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save');
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees/access', empPkey] });
      onNotify('Employee access updated successfully', 'success');
      onSaved();
    },
    onError: (err) => onNotify(String(err instanceof Error ? err.message : err), 'error'),
  });

  const resetDevice = useMutation({
    mutationFn: () => fetch(`/api/employees/access/${empPkey}/reset-device`, { method: 'POST' }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to reset device');
    }),
    onSuccess: () => onNotify('Device registration reset successfully', 'success'),
    onError: (err) => onNotify(String(err instanceof Error ? err.message : err), 'error'),
  });

  function handleResetDevice() {
    if (!data) return;
    const name = `${data.first_name} ${data.last_name ?? ''}`.trim();
    if (confirm(`This will force ${name} to re-register their device. This cannot be undone. Continue?`)) {
      resetDevice.mutate();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (passwordTooShort) return;
    save.mutate();
  }

  if (isError) {
    return <p className="text-sm text-[color:var(--color-danger)]">Couldn&apos;t load access details for this employee.</p>;
  }
  if (isLoading || !data) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div>
      <div className="mb-5">
        <h2 className="font-heading text-[20px] font-bold text-[#0F172A] tracking-tight">
          {data.first_name} {data.last_name ?? ''}
        </h2>
        <p className="text-[13.5px] text-slate-500 mt-1">Manage login access, mobile punch settings and password.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {!data.user_id && (
          <div>
            <label className={LABEL_CLASS}>Username <span className="text-[color:var(--color-danger)]">*</span></label>
            <input
              required
              className={INPUT_CLASS}
              value={form.user_id ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))}
              placeholder="e.g. GRTL100024"
            />
          </div>
        )}

        <div>
          <label className={LABEL_CLASS}>Email</label>
          <input
            type="email"
            className={INPUT_CLASS}
            value={form.email ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="employee@company.com"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={form.access_allowed === 'Y'}
              onChange={(e) => setForm((f) => ({ ...f, access_allowed: e.target.checked ? 'Y' : 'N' }))}
              className="accent-[color:var(--color-primary)]"
            />
            Web login enabled
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={form.locked === '1'}
              onChange={(e) => setForm((f) => ({ ...f, locked: e.target.checked ? '1' : '0' }))}
              className="accent-[color:var(--color-primary)]"
            />
            Account locked
          </label>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={form.mobile_allowed === 'Y'}
              onChange={(e) => setForm((f) => ({ ...f, mobile_allowed: e.target.checked ? 'Y' : 'N' }))}
              className="accent-[color:var(--color-primary)]"
            />
            Mobile access allowed
          </label>
          <p className="text-xs text-slate-400 mt-1.5">
            Mobile access is a separate channel from web login — an employee can have one enabled without the other.
          </p>
        </div>

        <div>
          <label className={LABEL_CLASS}>Punch Type</label>
          <select
            className={INPUT_CLASS}
            value={form.punch_type ?? 'W'}
            onChange={(e) => setForm((f) => ({ ...f, punch_type: e.target.value }))}
          >
            {PUNCH_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        <div>
          <label className={cn(LABEL_CLASS, 'flex items-center gap-1.5')}>
            <KeyRound className="w-3.5 h-3.5" /> Reset Password (leave blank to keep current)
          </label>
          <input
            type="password"
            className={INPUT_CLASS}
            value={form.new_password ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, new_password: e.target.value }))}
            disabled={form.access_allowed !== 'Y'}
            placeholder={
              form.access_allowed !== 'Y'
                ? 'Enable web login to set a password'
                : data.user_id ? '' : 'Required for a new login'
            }
          />
          {passwordTooShort && (
            <p className="text-[color:var(--color-danger)] text-xs mt-1.5">
              Password must be at least {MIN_PASSWORD_LENGTH} characters.
            </p>
          )}
        </div>

        {save.isError && <p className="text-[color:var(--color-danger)] text-sm">{String(save.error)}</p>}

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
          {data.user_id ? (
            <button
              type="button"
              onClick={handleResetDevice}
              disabled={resetDevice.isPending}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[color:var(--color-primary)] transition-colors duration-[180ms]"
            >
              <RotateCcw className="w-3.5 h-3.5" /> {resetDevice.isPending ? 'Resetting…' : 'Reset Device'}
            </button>
          ) : <span />}
          <button
            type="submit"
            disabled={save.isPending || passwordTooShort}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-[color:var(--color-primary)] hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100 text-white shadow-lg shadow-[color:var(--color-primary)]/20 transition-all duration-[180ms]"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
