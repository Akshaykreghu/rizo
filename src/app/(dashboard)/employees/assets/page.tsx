'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, RotateCcw, Search, Pencil } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { futureDateError } from '@/lib/validation';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { DataTable } from '@/components/data-table/DataTable';
import type { ColumnDef } from '@tanstack/react-table';

interface AllocationRow {
  allocate_pkey: number;
  emp_fkey: number;
  first_name: string;
  last_name: string | null;
  emp_id: string;
  asset: string;
  asset_name: string;
  model: string;
  brand: string;
  allocated_date: string;
  retreived_date: string | null;
  status: string;
  asset_state: number;
}

interface AssetOption {
  asset_pkey: number;
  name: string;
  status: string;
}

const ASSET_STATES = [
  { value: '1', label: 'Good' },
  { value: '2', label: 'Damaged But Working' },
  { value: '3', label: 'Not Working' },
];

const TODAY = new Date().toISOString().slice(0, 10);

export default function AllocateAssetsPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ emp_fkey: '', asset: '', allocated_date: '', asset_state: '1', description: '' });
  const [formError, setFormError] = useState('');
  const [editRow, setEditRow] = useState<AllocationRow | null>(null);
  const [editForm, setEditForm] = useState({ allocated_date: '', asset_state: '1', description: '' });
  const [editError, setEditError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const pageSize = 25;

  const { data, isLoading } = useQuery<{ data: AllocationRow[]; total: number }>({
    queryKey: ['employees/assets', page, pageSize, search],
    queryFn: () => fetch(`/api/employees/assets?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`).then((r) => r.json()),
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  const { data: assets = [] } = useQuery<AssetOption[]>({
    queryKey: ['assets'],
    queryFn: () => fetch('/api/assets').then((r) => r.json()),
    enabled: showModal,
  });

  const allocate = useMutation({
    mutationFn: () => fetch('/api/employees/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to allocate');
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees/assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setShowModal(false);
      setForm({ emp_fkey: '', asset: '', allocated_date: '', asset_state: '1', description: '' });
    },
  });

  const returnAsset = useMutation({
    mutationFn: (allocatePkey: number) => fetch(`/api/employees/assets/${allocatePkey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to mark as returned');
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees/assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (err) => alert(String(err instanceof Error ? err.message : err)),
  });

  const editAllocation = useMutation({
    mutationFn: () => fetch(`/api/employees/assets/${editRow!.allocate_pkey}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to update allocation');
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees/assets'] });
      setEditRow(null);
    },
    onError: (err) => setEditError(String(err instanceof Error ? err.message : err)),
  });

  function openEdit(row: AllocationRow) {
    setEditRow(row);
    setEditError('');
    setEditForm({
      allocated_date: row.allocated_date.slice(0, 10),
      asset_state: String(row.asset_state ?? 1),
      description: '',
    });
  }

  const availableAssets = assets.filter((a) => a.status !== 'Allocated');

  const columns: ColumnDef<AllocationRow, unknown>[] = [
    {
      id: 'employee',
      header: 'Employee',
      accessorFn: (row) => `${row.first_name} ${row.last_name ?? ''}`,
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-gray-900">{row.original.first_name} {row.original.last_name ?? ''}</div>
          <div className="text-xs text-gray-400">{row.original.emp_id}</div>
        </div>
      ),
    },
    {
      id: 'asset',
      header: 'Asset',
      accessorKey: 'asset_name',
      cell: ({ row }) => (
        <div>
          <div className="text-gray-800">{row.original.asset_name}</div>
          <div className="text-xs text-gray-400">{row.original.model} {row.original.brand}</div>
        </div>
      ),
    },
    {
      accessorKey: 'allocated_date',
      header: 'Allocated',
      cell: ({ getValue }) => formatDate(String(getValue() ?? '')),
    },
    {
      accessorKey: 'retreived_date',
      header: 'Returned',
      cell: ({ getValue }) => { const v = getValue() as string | null; return v ? formatDate(v) : '—'; },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => (
        <span className={getValue() === 'Allocated' ? 'text-emerald-600 text-xs font-medium' : 'text-gray-400 text-xs font-medium'}>
          {String(getValue())}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(row.original); }}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          {row.original.status === 'Allocated' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm('Mark this asset as returned? This cannot be undone from here.')) {
                  returnAsset.mutate(row.original.allocate_pkey);
                }
              }}
              className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 font-medium"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Mark Returned
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Allocate Assets</h1>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Allocate Asset
        </button>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 max-w-sm mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by employee name or ID"
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

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Allocate Asset</h2>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const err = futureDateError(form.allocated_date, 'Allocated date');
                if (err) { setFormError(err); return; }
                setFormError('');
                allocate.mutate();
              }}
              className="space-y-4"
            >
              <div>
                <label className="label">Employee <span className="text-red-500">*</span></label>
                <EmployeeSearch value={form.emp_fkey} onChange={(v) => setForm((f) => ({ ...f, emp_fkey: v }))} />
              </div>
              <div>
                <label className="label">Asset <span className="text-red-500">*</span></label>
                <select required className="input" value={form.asset} onChange={(e) => setForm((f) => ({ ...f, asset: e.target.value }))}>
                  <option value="">Select asset</option>
                  {availableAssets.map((a) => <option key={a.asset_pkey} value={a.asset_pkey}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Allocated Date <span className="text-red-500">*</span></label>
                <input required type="date" max={TODAY} className="input" value={form.allocated_date} onChange={(e) => setForm((f) => ({ ...f, allocated_date: e.target.value }))} />
              </div>
              <div>
                <label className="label">Condition</label>
                <select className="input" value={form.asset_state} onChange={(e) => setForm((f) => ({ ...f, asset_state: e.target.value }))}>
                  {ASSET_STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Notes</label>
                <input className="input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>

              {(formError || allocate.isError) && (
                <p className="text-red-500 text-sm">{formError || String(allocate.error)}</p>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={allocate.isPending}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400"
                >
                  {allocate.isPending ? 'Allocating…' : 'Allocate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditRow(null)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">Edit Allocation</h2>
              <button onClick={() => setEditRow(null)} className="p-1 rounded hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <p className="text-xs text-gray-500 -mt-3 mb-4">
              {editRow.first_name} {editRow.last_name ?? ''} — {editRow.asset_name}
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const err = futureDateError(editForm.allocated_date, 'Allocated date');
                if (err) { setEditError(err); return; }
                setEditError('');
                editAllocation.mutate();
              }}
              className="space-y-4"
            >
              <div>
                <label className="label">Allocated Date <span className="text-red-500">*</span></label>
                <input
                  required
                  type="date"
                  max={editRow.retreived_date ? editRow.retreived_date.slice(0, 10) : TODAY}
                  className="input"
                  value={editForm.allocated_date}
                  onChange={(e) => setEditForm((f) => ({ ...f, allocated_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Condition</label>
                <select className="input" value={editForm.asset_state} onChange={(e) => setEditForm((f) => ({ ...f, asset_state: e.target.value }))}>
                  {ASSET_STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Notes</label>
                <input className="input" value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
              </div>

              {editError && <p className="text-red-500 text-sm">{editError}</p>}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setEditRow(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editAllocation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400"
                >
                  {editAllocation.isPending ? 'Saving…' : 'Save Changes'}
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
