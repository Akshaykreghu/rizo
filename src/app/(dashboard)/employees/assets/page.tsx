'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, RotateCcw, Search, Pencil } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { futureDateError } from '@/lib/validation';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';
import type { ColumnDef } from '@tanstack/react-table';

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

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
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ emp_fkey: '', asset: '', allocated_date: '', asset_state: '1', description: '' });
  const [formError, setFormError] = useState('');
  const [editRow, setEditRow] = useState<AllocationRow | null>(null);
  const [editForm, setEditForm] = useState({ allocated_date: '', asset_state: '1', description: '' });
  const [editError, setEditError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

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
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Allocate Assets
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Assign company assets to employees and track returns
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
              placeholder="Search by employee name or ID"
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
          onClick={() => setShowModal(true)}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" /> Allocate Asset
        </button>
      </div>

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        pageSize={pageSize}
        pageSizeOptions={[10, 25, 50]}
        totalRows={data?.total ?? 0}
        onPageChange={(p, ps) => { setPage(p); setPageSize(ps); }}
        isLoading={isLoading}
      />

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setShowModal(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">Allocate Asset</h2>
              <button onClick={() => setShowModal(false)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
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
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Employee <span className="text-[color:var(--color-danger)]">*</span></label>
                <EmployeeSearch value={form.emp_fkey} onChange={(v) => setForm((f) => ({ ...f, emp_fkey: v }))} />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Asset <span className="text-[color:var(--color-danger)]">*</span></label>
                <select required className={cn(INPUT_CLASS, 'w-full')} value={form.asset} onChange={(e) => setForm((f) => ({ ...f, asset: e.target.value }))}>
                  <option value="">Select asset</option>
                  {availableAssets.map((a) => <option key={a.asset_pkey} value={a.asset_pkey}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Allocated Date <span className="text-[color:var(--color-danger)]">*</span></label>
                <input required type="date" max={TODAY} className={cn(INPUT_CLASS, 'w-full')} value={form.allocated_date} onChange={(e) => setForm((f) => ({ ...f, allocated_date: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Condition</label>
                <select className={cn(INPUT_CLASS, 'w-full')} value={form.asset_state} onChange={(e) => setForm((f) => ({ ...f, asset_state: e.target.value }))}>
                  {ASSET_STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Notes</label>
                <input className={cn(INPUT_CLASS, 'w-full')} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>

              {(formError || allocate.isError) && (
                <p className="text-[color:var(--color-danger)] text-[12.5px]">{formError || String(allocate.error)}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={allocate.isPending}
                  className={cn(
                    'px-4 py-2.5 text-sm font-semibold text-white rounded-xl shadow-sm transition-colors duration-150',
                    allocate.isPending
                      ? 'bg-[color:var(--color-primary)]/60 cursor-not-allowed'
                      : 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)]'
                  )}
                >
                  {allocate.isPending ? 'Allocating…' : 'Allocate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setEditRow(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">Edit Allocation</h2>
              <button onClick={() => setEditRow(null)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            <p className="text-[11.5px] text-slate-500 -mt-3 mb-4">
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
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Allocated Date <span className="text-[color:var(--color-danger)]">*</span></label>
                <input
                  required
                  type="date"
                  max={editRow.retreived_date ? editRow.retreived_date.slice(0, 10) : TODAY}
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={editForm.allocated_date}
                  onChange={(e) => setEditForm((f) => ({ ...f, allocated_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Condition</label>
                <select className={cn(INPUT_CLASS, 'w-full')} value={editForm.asset_state} onChange={(e) => setEditForm((f) => ({ ...f, asset_state: e.target.value }))}>
                  {ASSET_STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Notes</label>
                <input className={cn(INPUT_CLASS, 'w-full')} value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
              </div>

              {editError && <p className="text-[color:var(--color-danger)] text-[12.5px]">{editError}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditRow(null)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editAllocation.isPending}
                  className={cn(
                    'px-4 py-2.5 text-sm font-semibold text-white rounded-xl shadow-sm transition-colors duration-150',
                    editAllocation.isPending
                      ? 'bg-[color:var(--color-primary)]/60 cursor-not-allowed'
                      : 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)]'
                  )}
                >
                  {editAllocation.isPending ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
