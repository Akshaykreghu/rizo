'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Unlock, Smartphone, RotateCcw, KeyRound, X, Search, Users } from 'lucide-react';
import { DataTable } from '@/components/data-table/DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

interface AccessRow {
  emp_pkey: number;
  first_name: string;
  last_name: string | null;
  mobile_no: string;
  email: string;
  emp_company_id: string | null;
  user_pkey: number | null;
  user_id: string | null;
  access_allowed: string | null;
  locked: number | null;
  reset_login_flag: string | null;
  mobile_locked: string | null;
  punchtype: string | null;
}

interface BranchOption { branch_code: string; branch_name: string }

const PUNCH_TYPES = [
  { value: 'W', label: 'Machine (Biometric/Device)' },
  { value: 'M', label: 'Mobile from anywhere' },
  { value: 'O', label: 'Mobile from office only' },
  { value: 'S', label: 'Web' },
];

const MIN_PASSWORD_LENGTH = 8;

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];

function Toast({ message, type, onDismiss }: { message: string; type: 'success' | 'error'; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className={`fixed top-4 right-4 z-[60] px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${
        type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
      }`}
    >
      {message}
    </div>
  );
}

export default function EmployeeAccessPage() {
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AccessRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const { data, isLoading } = useQuery<{ data: AccessRow[]; total: number }>({
    queryKey: ['employees/access', page, pageSize, search],
    queryFn: () => fetch(`/api/employees/access?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`).then((r) => r.json()),
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  const passwordTooShort = !!form.new_password && form.new_password.length < MIN_PASSWORD_LENGTH;

  const save = useMutation({
    mutationFn: () => fetch(`/api/employees/access/${editing!.emp_pkey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save');
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees/access'] });
      setEditing(null);
      setToast({ message: 'Employee access updated successfully', type: 'success' });
    },
  });

  const resetDevice = useMutation({
    mutationFn: (empPkey: number) => fetch(`/api/employees/access/${empPkey}/reset-device`, { method: 'POST' }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to reset device');
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees/access'] });
      setToast({ message: 'Device registration reset successfully', type: 'success' });
    },
    onError: (err) => setToast({ message: String(err instanceof Error ? err.message : err), type: 'error' }),
  });

  function handleResetDevice(row: AccessRow) {
    const name = `${row.first_name} ${row.last_name ?? ''}`.trim();
    if (confirm(`This will force ${name} to re-register their device. This cannot be undone. Continue?`)) {
      resetDevice.mutate(row.emp_pkey);
    }
  }

  function openEdit(row: AccessRow) {
    setEditing(row);
    setForm({
      user_id: row.user_id ?? '',
      email: row.email ?? '',
      access_allowed: row.access_allowed ?? 'N',
      locked: row.locked ? '1' : '0',
      mobile_allowed: row.mobile_locked === 'Y' ? 'N' : 'Y',
      punch_type: row.punchtype ?? 'W',
      new_password: '',
    });
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (passwordTooShort) return;
    save.mutate();
  }

  const columns: ColumnDef<AccessRow, unknown>[] = [
    {
      id: 'employee',
      header: 'Employee',
      accessorFn: (row) => `${row.first_name} ${row.last_name ?? ''}`,
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-gray-900">{row.original.first_name} {row.original.last_name ?? ''}</div>
          <div className="text-xs text-gray-400">{row.original.emp_company_id}</div>
        </div>
      ),
    },
    {
      accessorKey: 'user_id',
      header: 'Username',
      cell: ({ getValue }) => getValue() ?? <span className="text-gray-400 italic">no login</span>,
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ getValue }) => getValue() || <span className="text-gray-400">—</span>,
    },
    {
      id: 'web_login',
      header: 'Web Login',
      cell: ({ row }) => row.original.user_id ? (
        <span className={`inline-flex items-center gap-1 text-xs font-medium ${row.original.access_allowed === 'Y' && !row.original.locked ? 'text-emerald-600' : 'text-gray-400'}`}>
          {row.original.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          {row.original.locked ? 'Locked' : row.original.access_allowed === 'Y' ? 'Enabled' : 'Disabled'}
        </span>
      ) : '—',
    },
    {
      id: 'mobile_access',
      header: 'Mobile Access',
      cell: ({ row }) => row.original.user_id && (
        <span className={`inline-flex items-center gap-1 text-xs font-medium ${row.original.mobile_locked === 'N' ? 'text-emerald-600' : 'text-gray-400'}`}>
          <Smartphone className="w-3.5 h-3.5" />
          {row.original.mobile_locked === 'N' ? 'Allowed' : 'Blocked'}
        </span>
      ),
    },
    {
      id: 'punch_type',
      header: 'Punch Type',
      cell: ({ row }) => PUNCH_TYPES.find((p) => p.value === row.original.punchtype)?.label ?? '—',
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <button onClick={(e) => { e.stopPropagation(); openEdit(row.original); }} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
            Manage
          </button>
          {row.original.user_id && (
            <button
              onClick={(e) => { e.stopPropagation(); handleResetDevice(row.original); }}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
              title="Reset mobile device registration"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset Device
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Employee Access
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Manage web/mobile login, device resets, and passwords
            </p>
          </div>,
          slotEl
        )}

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <form onSubmit={handleSearch} className="flex gap-2 max-w-sm flex-1">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name or username"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className={cn(INPUT_CLASS, 'w-full pl-8')}
            />
          </div>
          <button type="submit" className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}>
            Search
          </button>
        </form>

        <button
          onClick={() => setBulkOpen(true)}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Users className="w-3.5 h-3.5" /> Bulk Access
        </button>
      </div>

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        totalRows={data?.total ?? 0}
        onPageChange={(p, ps) => { setPage(p); setPageSize(ps); }}
        isLoading={isLoading}
      />

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setEditing(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">
                {editing.first_name} {editing.last_name ?? ''}
              </h2>
              <button onClick={() => setEditing(null)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              {!editing.user_id && (
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Username <span className="text-[color:var(--color-danger)]">*</span></label>
                  <input
                    required
                    className={cn(INPUT_CLASS, 'w-full')}
                    value={form.user_id}
                    onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))}
                    placeholder="e.g. GRTL100024"
                  />
                </div>
              )}

              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Email</label>
                <input
                  type="email"
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="employee@company.com"
                />
              </div>

              <label className="flex items-center gap-2 text-[13px] font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.access_allowed === 'Y'}
                  onChange={(e) => setForm((f) => ({ ...f, access_allowed: e.target.checked ? 'Y' : 'N' }))}
                  className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40"
                />
                Web login enabled
              </label>

              <label className="flex items-center gap-2 text-[13px] font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.locked === '1'}
                  onChange={(e) => setForm((f) => ({ ...f, locked: e.target.checked ? '1' : '0' }))}
                  className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40"
                />
                Account locked
              </label>

              <div className="border-t border-slate-100 pt-3">
                <label className="flex items-center gap-2 text-[13px] font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.mobile_allowed === 'Y'}
                    onChange={(e) => setForm((f) => ({ ...f, mobile_allowed: e.target.checked ? 'Y' : 'N' }))}
                    className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40"
                  />
                  Mobile access allowed
                </label>
                <p className="text-[11.5px] text-slate-400 mt-1">
                  Mobile access is a separate channel from web login — an employee can have one enabled without the other.
                </p>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Punch Type</label>
                <select
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={form.punch_type}
                  onChange={(e) => setForm((f) => ({ ...f, punch_type: e.target.value }))}
                >
                  {PUNCH_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600 mb-1.5"><KeyRound className="w-3.5 h-3.5" /> Reset Password (leave blank to keep current)</label>
                <input
                  type="password"
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={form.new_password}
                  onChange={(e) => setForm((f) => ({ ...f, new_password: e.target.value }))}
                  disabled={form.access_allowed !== 'Y'}
                  placeholder={
                    form.access_allowed !== 'Y'
                      ? 'Enable web login to set a password'
                      : editing.user_id ? '' : 'Required for a new login'
                  }
                />
                {passwordTooShort && (
                  <p className="text-[color:var(--color-danger)] text-[11.5px] mt-1">Password must be at least {MIN_PASSWORD_LENGTH} characters.</p>
                )}
              </div>

              {save.isError && <p className="text-[color:var(--color-danger)] text-[12.5px]">{String(save.error)}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={save.isPending || passwordTooShort}
                  className={cn(
                    'px-4 py-2.5 text-sm font-semibold text-white rounded-xl shadow-sm transition-colors duration-150',
                    save.isPending || passwordTooShort
                      ? 'bg-[color:var(--color-primary)]/60 cursor-not-allowed'
                      : 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)]'
                  )}
                >
                  {save.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {bulkOpen && <BulkAccessModal onClose={() => setBulkOpen(false)} onDone={(msg, type) => setToast({ message: msg, type })} />}
    </div>
  );
}

// Ports UserCredentialsController::saveBulkAccess() — provisions a first-time web+mobile login
// (via the existing `user_access_firstime_only` stored function) for every employee in a branch
// who doesn't already have one, sets them all to the same initial password, and emails each of
// them their credentials. Deliberately NOT a "reset every password in the branch" tool — the
// underlying function only ever touches employees with a null/blank password (its cursor's own
// WHERE clause), matching its name exactly.
function BulkAccessModal({ onClose, onDone }: { onClose: () => void; onDone: (message: string, type: 'success' | 'error') => void }) {
  const [branch, setBranch] = useState('');
  const [password, setPassword] = useState('');

  const { data: branches = [] } = useQuery<BranchOption[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()).then((rows: Record<string, unknown>[]) =>
      rows.map((r) => ({ branch_code: String(r.branch_code), branch_name: String(r.branch_name) }))
    ),
  });

  const passwordTooShort = !!password && password.length < MIN_PASSWORD_LENGTH;

  const apply = useMutation({
    mutationFn: () => fetch('/api/employees/access/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch_code: branch, password }),
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Bulk access provisioning failed');
      return data;
    }),
    onSuccess: (data) => {
      onDone(data.message ?? 'Bulk access provisioned successfully', 'success');
      onClose();
    },
    onError: (err) => onDone(String(err instanceof Error ? err.message : err), 'error'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md animate-modal-in"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">Bulk Access</h2>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
            <X className="w-4.5 h-4.5" />
          </button>
        </div>
        <p className="text-[11.5px] text-slate-500 mb-4">
          Creates a first-time login for every employee in the selected branch who doesn&apos;t
          already have one, sets the password below for all of them, and emails each their credentials.
          Employees who already have a login are left untouched.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Branch</label>
            <select className={cn(INPUT_CLASS, 'w-full')} value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">Select branch</option>
              {branches.map((b) => <option key={b.branch_code} value={b.branch_code}>{b.branch_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Initial Password</label>
            <input
              type="password"
              className={cn(INPUT_CLASS, 'w-full')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {passwordTooShort && (
              <p className="text-[color:var(--color-danger)] text-[11.5px] mt-1">Password must be at least {MIN_PASSWORD_LENGTH} characters.</p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => apply.mutate()}
              disabled={!branch || !password || passwordTooShort || apply.isPending}
              className={cn(
                'px-4 py-2.5 text-sm font-semibold text-white rounded-xl shadow-sm transition-colors duration-150',
                !branch || !password || passwordTooShort || apply.isPending
                  ? 'bg-[color:var(--color-primary)]/60 cursor-not-allowed'
                  : 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)]'
              )}
            >
              {apply.isPending ? 'Applying…' : 'Apply to Branch'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
