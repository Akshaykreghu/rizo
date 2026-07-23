'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Unlock, Smartphone, RotateCcw, KeyRound, X, Search } from 'lucide-react';
import { DataTable } from '@/components/data-table/DataTable';
import type { ColumnDef } from '@tanstack/react-table';

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

const PUNCH_TYPES = [
  { value: 'W', label: 'Machine (Biometric/Device)' },
  { value: 'M', label: 'Mobile from anywhere' },
  { value: 'O', label: 'Mobile from office only' },
  { value: 'S', label: 'Web' },
];

export default function EmployeeAccessPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AccessRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const pageSize = 25;

  const { data, isLoading } = useQuery<{ data: AccessRow[]; total: number }>({
    queryKey: ['employees/access', page, pageSize, search],
    queryFn: () => fetch(`/api/employees/access?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`).then((r) => r.json()),
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

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
    },
  });

  const resetDevice = useMutation({
    mutationFn: (empPkey: number) => fetch(`/api/employees/access/${empPkey}/reset-device`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees/access'] }),
  });

  function openEdit(row: AccessRow) {
    setEditing(row);
    setForm({
      user_id: row.user_id ?? '',
      access_allowed: row.access_allowed ?? 'N',
      locked: row.locked ? '1' : '0',
      mobile_allowed: row.mobile_locked === 'Y' ? 'N' : 'Y',
      punch_type: row.punchtype ?? 'W',
      new_password: '',
    });
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
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
              onClick={(e) => { e.stopPropagation(); resetDevice.mutate(row.original.emp_pkey); }}
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
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Employee Access</h1>

      <form onSubmit={handleSearch} className="flex gap-2 max-w-sm mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or username"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <button type="submit" className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm transition-colors">
          Search
        </button>
      </form>

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        pageSize={pageSize}
        totalRows={data?.total ?? 0}
        onPageChange={(p) => setPage(p)}
        isLoading={isLoading}
      />

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditing(null)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">
                {editing.first_name} {editing.last_name ?? ''}
              </h2>
              <button onClick={() => setEditing(null)} className="p-1 rounded hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              {!editing.user_id && (
                <div>
                  <label className="label">Username <span className="text-red-500">*</span></label>
                  <input
                    required
                    className="input"
                    value={form.user_id}
                    onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))}
                    placeholder="e.g. GRTL100024"
                  />
                </div>
              )}

              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={form.access_allowed === 'Y'}
                  onChange={(e) => setForm((f) => ({ ...f, access_allowed: e.target.checked ? 'Y' : 'N' }))}
                />
                Web login enabled
              </label>

              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={form.locked === '1'}
                  onChange={(e) => setForm((f) => ({ ...f, locked: e.target.checked ? '1' : '0' }))}
                />
                Account locked
              </label>

              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={form.mobile_allowed === 'Y'}
                  onChange={(e) => setForm((f) => ({ ...f, mobile_allowed: e.target.checked ? 'Y' : 'N' }))}
                />
                Mobile access allowed
              </label>

              <div>
                <label className="label">Punch Type</label>
                <select
                  className="input"
                  value={form.punch_type}
                  onChange={(e) => setForm((f) => ({ ...f, punch_type: e.target.value }))}
                >
                  {PUNCH_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>

              <div>
                <label className="label flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" /> Reset Password (leave blank to keep current)</label>
                <input
                  type="password"
                  className="input"
                  value={form.new_password}
                  onChange={(e) => setForm((f) => ({ ...f, new_password: e.target.value }))}
                  placeholder={editing.user_id ? '' : 'Required for a new login'}
                />
              </div>

              {save.isError && <p className="text-red-500 text-sm">{String(save.error)}</p>}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={save.isPending}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400"
                >
                  {save.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx>{`
        .label { display: block; font-size: 0.875rem; font-weight: 500; color: #374151; margin-bottom: 0.25rem; }
        .input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 0.5rem; font-size: 0.875rem; outline: none; }
        .input:focus { box-shadow: 0 0 0 2px #6366f1; border-color: transparent; }
      `}</style>
    </div>
  );
}
