'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, RotateCcw, Search, Pencil, History } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { futureDateError } from '@/lib/validation';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
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
  description: string | null;
  official_mail: string | null;
  official_contact: string | null;
  crm_id: string | null;
  allocated_ofc_space: string | null;
}

interface AssetOption {
  asset_pkey: number;
  name: string;
  status: string;
  Type: number | string | null;
  TypeName: string | null;
  not_working?: number | boolean;
}

interface BranchOption {
  branch_code: string;
  branch_name: string;
}

interface HistoryRow {
  allocate_pkey: number;
  first_name: string;
  last_name: string | null;
  emp_id: string;
  allocated_date: string;
  retreived_date: string | null;
  status: string;
  asset_state: number;
  damaged_amout: string | null;
  description: string | null;
}

const ASSET_STATES = [
  { value: '1', label: 'Good' },
  { value: '2', label: 'Damaged But Working' },
  { value: '3', label: 'Not Working' },
];

const TODAY = new Date().toISOString().slice(0, 10);

const ASSET_STATE_LABEL: Record<number, string> = { 1: 'Good', 2: 'Damaged But Working', 3: 'Not Working' };

type MetaValues = { official_mail: string; official_contact: string; crm_id: string; allocated_ofc_space: string };

/** The four optional allocation metadata fields legacy captures (Official Mail/Contact, CRM ID,
 * Office Space) — shared by the Allocate and Edit modals so they can't drift apart. */
function AdditionalDetails({ values, onChange }: { values: MetaValues; onChange: (patch: Partial<MetaValues>) => void }) {
  return (
    <details className="rounded-[9px] border border-slate-200 px-3 py-2">
      <summary className="text-[12px] font-medium text-slate-600 cursor-pointer select-none">Additional details</summary>
      <div className="space-y-3 mt-3">
        <div>
          <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Official Mail ID</label>
          <input type="email" className={cn(INPUT_CLASS, 'w-full')} value={values.official_mail} onChange={(e) => onChange({ official_mail: e.target.value })} />
        </div>
        <div>
          <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Official Contact Number</label>
          <input className={cn(INPUT_CLASS, 'w-full')} value={values.official_contact} onChange={(e) => onChange({ official_contact: e.target.value })} />
        </div>
        <div>
          <label className="block text-[12px] font-medium text-slate-600 mb-1.5">CRM ID</label>
          <input className={cn(INPUT_CLASS, 'w-full')} value={values.crm_id} onChange={(e) => onChange({ crm_id: e.target.value })} />
        </div>
        <div>
          <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Allocated Office Space</label>
          <input className={cn(INPUT_CLASS, 'w-full')} value={values.allocated_ofc_space} onChange={(e) => onChange({ allocated_ofc_space: e.target.value })} />
        </div>
      </div>
    </details>
  );
}

interface AllocateAssetsPageProps {
  /** When set, the page runs scoped to this one employee: no header title, no search, employee locked. */
  embeddedEmpPkey?: number;
  embeddedEmpName?: string;
}

export default function AllocateAssetsPage({ embeddedEmpPkey, embeddedEmpName }: AllocateAssetsPageProps = {}) {
  const embedded = embeddedEmpPkey != null;
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const EMPTY_META = { official_mail: '', official_contact: '', crm_id: '', allocated_ofc_space: '' };
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ emp_fkey: embedded ? String(embeddedEmpPkey) : '', asset: '', asset_type: '', allocated_date: '', asset_state: '1', description: '', ...EMPTY_META });
  const [formError, setFormError] = useState('');
  const [editRow, setEditRow] = useState<AllocationRow | null>(null);
  const [editForm, setEditForm] = useState({ allocated_date: '', asset_state: '1', description: '', ...EMPTY_META });
  const [editError, setEditError] = useState('');
  const [returnRow, setReturnRow] = useState<AllocationRow | null>(null);
  const [returnForm, setReturnForm] = useState({ damaged: false, damaged_amout: '' });
  const [historyRow, setHistoryRow] = useState<AllocationRow | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [branch, setBranch] = useState('');

  // Reset to the first page whenever a filter narrows the result set.
  useEffect(() => { setPage(1); }, [search, branch]);

  const { data, isLoading } = useQuery<{ data: AllocationRow[]; total: number }>({
    queryKey: ['employees/assets', page, pageSize, search, branch, embeddedEmpPkey ?? null],
    queryFn: () => fetch(
      `/api/employees/assets?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`
      + `${branch ? `&branch=${encodeURIComponent(branch)}` : ''}`
      + `${embedded ? `&emp_fkey=${embeddedEmpPkey}` : ''}`
    ).then((r) => r.json()),
  });

  const { data: assets = [] } = useQuery<AssetOption[]>({
    queryKey: ['assets'],
    queryFn: () => fetch('/api/assets').then((r) => r.json()),
    enabled: showModal,
  });

  const { data: branches = [] } = useQuery<BranchOption[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()),
    enabled: !embedded,
  });

  const { data: history } = useQuery<{ data: HistoryRow[] }>({
    queryKey: ['employees/assets/history', historyRow?.asset ?? null],
    queryFn: () => fetch(`/api/employees/assets/history?asset=${encodeURIComponent(historyRow!.asset)}`).then((r) => r.json()),
    enabled: historyRow != null,
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
      setForm({ emp_fkey: embedded ? String(embeddedEmpPkey) : '', asset: '', asset_type: '', allocated_date: '', asset_state: '1', description: '', ...EMPTY_META });
    },
  });

  const returnAsset = useMutation({
    mutationFn: (vars: { allocatePkey: number; damaged_amout?: string; retrieved_damage?: 'Y' | 'N' }) =>
      fetch(`/api/employees/assets/${vars.allocatePkey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ damaged_amout: vars.damaged_amout ?? '', retrieved_damage: vars.retrieved_damage ?? 'N' }),
      }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to mark as returned');
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees/assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setReturnRow(null);
      setReturnForm({ damaged: false, damaged_amout: '' });
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
      description: row.description ?? '',
      official_mail: row.official_mail ?? '',
      official_contact: row.official_contact ?? '',
      crm_id: row.crm_id ?? '',
      allocated_ofc_space: row.allocated_ofc_space ?? '',
    });
  }

  // Legacy Allocatenew/getEmi only offer assets that are not currently allocated and were
  // never marked "Not Working" (asset_state 3). Asset Type, when chosen, narrows further.
  const availableAssets = assets.filter(
    (a) => a.status !== 'Allocated' && !a.not_working && (!form.asset_type || String(a.Type) === form.asset_type)
  );
  const assetTypes = Array.from(
    new Map(
      assets
        .filter((a) => a.status !== 'Allocated' && !a.not_working && a.Type != null)
        .map((a) => [String(a.Type), a.TypeName ?? String(a.Type)] as const)
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

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
          <button
            onClick={(e) => { e.stopPropagation(); setHistoryRow(row.original); }}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 font-medium"
          >
            <History className="w-3.5 h-3.5" /> History
          </button>
          {row.original.status === 'Allocated' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setReturnForm({ damaged: false, damaged_amout: '' });
                setReturnRow(row.original);
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
      {!embedded && slotEl &&
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

      {embedded && (
        <h2 className="font-heading text-[20px] font-bold text-[#0F172A] tracking-tight mb-4">Allocate Assets</h2>
      )}

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        {!embedded ? (
          <div className="flex gap-2 flex-1 flex-wrap items-center">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search by employee name or ID"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className={cn(INPUT_CLASS, 'w-full pl-8')}
              />
            </div>
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className={cn(INPUT_CLASS)}
              aria-label="Filter by branch"
            >
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.branch_code} value={b.branch_code}>{b.branch_name}</option>)}
            </select>
          </div>
        ) : <span />}

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
            className="modal-scroll relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md max-h-[90vh] overflow-y-auto animate-modal-in"
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
                {embedded ? (
                  <div className={cn(INPUT_CLASS, 'w-full bg-slate-50 text-slate-500')}>{embeddedEmpName}</div>
                ) : (
                  <EmployeeSearch value={form.emp_fkey} onChange={(v) => setForm((f) => ({ ...f, emp_fkey: v }))} />
                )}
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Asset Type <span className="text-[color:var(--color-danger)]">*</span></label>
                <select
                  required
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={form.asset_type}
                  onChange={(e) => setForm((f) => ({ ...f, asset_type: e.target.value, asset: '' }))}
                >
                  <option value="">Select</option>
                  {assetTypes.map(([pkey, typeName]) => <option key={pkey} value={pkey}>{typeName}</option>)}
                </select>
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

              <AdditionalDetails values={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />

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
            className="modal-scroll relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md max-h-[90vh] overflow-y-auto animate-modal-in"
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

              <AdditionalDetails values={editForm} onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))} />

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

      {returnRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setReturnRow(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="modal-scroll relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md max-h-[90vh] overflow-y-auto animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">Mark Returned</h2>
              <button onClick={() => setReturnRow(null)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            <p className="text-[12.5px] text-slate-500 -mt-3 mb-4">
              {returnRow.first_name} {returnRow.last_name ?? ''} — {returnRow.asset_name}. The returned date is set to today and this cannot be undone from here.
            </p>

            <label className="flex items-center gap-2 text-[12.5px] text-slate-700 mb-3">
              <input
                type="checkbox"
                checked={returnForm.damaged}
                onChange={(e) => setReturnForm((f) => ({ ...f, damaged: e.target.checked, damaged_amout: e.target.checked ? f.damaged_amout : '' }))}
              />
              Asset returned damaged
            </label>
            {returnForm.damaged && (
              <div className="mb-4">
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Damaged Amount</label>
                <input
                  type="number"
                  min="0"
                  className={cn(INPUT_CLASS, 'w-full')}
                  value={returnForm.damaged_amout}
                  onChange={(e) => setReturnForm((f) => ({ ...f, damaged_amout: e.target.value }))}
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setReturnRow(null)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">
                Cancel
              </button>
              <button
                type="button"
                disabled={returnAsset.isPending}
                onClick={() => returnAsset.mutate({
                  allocatePkey: returnRow.allocate_pkey,
                  damaged_amout: returnForm.damaged ? returnForm.damaged_amout : '',
                  retrieved_damage: returnForm.damaged ? 'Y' : 'N',
                })}
                className={cn(
                  'px-4 py-2.5 text-sm font-semibold text-white rounded-xl shadow-sm transition-colors duration-150',
                  returnAsset.isPending
                    ? 'bg-[color:var(--color-primary)]/60 cursor-not-allowed'
                    : 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)]'
                )}
              >
                {returnAsset.isPending ? 'Saving…' : 'Mark Returned'}
              </button>
            </div>
          </div>
        </div>
      )}

      {historyRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setHistoryRow(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-lg animate-modal-in"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">Allocation History — {historyRow.asset_name}</h2>
              <button onClick={() => setHistoryRow(null)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3 font-medium">Employee</th>
                    <th className="py-2 pr-3 font-medium">Allocated</th>
                    <th className="py-2 pr-3 font-medium">Returned</th>
                    <th className="py-2 pr-3 font-medium">Condition</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(history?.data ?? []).map((h) => (
                    <tr key={h.allocate_pkey} className="border-b border-slate-100">
                      <td className="py-2 pr-3">
                        <div className="text-gray-900">{h.first_name} {h.last_name ?? ''}</div>
                        <div className="text-[11px] text-gray-400">{h.emp_id}</div>
                      </td>
                      <td className="py-2 pr-3">{formatDate(String(h.allocated_date ?? ''))}</td>
                      <td className="py-2 pr-3">{h.retreived_date ? formatDate(h.retreived_date) : '—'}</td>
                      <td className="py-2 pr-3">
                        {ASSET_STATE_LABEL[h.asset_state] ?? '—'}
                        {h.damaged_amout ? ` (₹${h.damaged_amout})` : ''}
                      </td>
                      <td className="py-2">{h.status}</td>
                    </tr>
                  ))}
                  {history && history.data.length === 0 && (
                    <tr><td colSpan={5} className="py-4 text-center text-slate-400">No history found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
