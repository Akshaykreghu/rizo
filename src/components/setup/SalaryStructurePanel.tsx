'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, PowerOff, Search, Calculator } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { DataTable } from '@/components/data-table/DataTable';
import { Modal } from '@/components/ui/Modal';
import { SalaryStructureForm } from '@/components/setup/SalaryStructureForm';
import { SalaryStructurePreview } from '@/components/setup/SalaryStructurePreview';
import type { ColumnDef } from '@tanstack/react-table';

interface StructureListItem {
  structure_id: number;
  structure_name: string;
  structure_eg_amt: number;
  fixed_days: number;
  prorate_code: string;
  structure_active: number;
}

export function SalaryStructurePanel() {
  const queryClient = useQueryClient();
  const [deactivateConfirm, setDeactivateConfirm] = useState<number | null>(null);
  const [previewTarget, setPreviewTarget] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  // 'new' | a structure id being edited | null (closed)
  const [modalTarget, setModalTarget] = useState<'new' | number | null>(null);

  function handleSaved(id: number) {
    queryClient.invalidateQueries({ queryKey: ['setup/salary-structures'] });
    // New structures switch into edit mode in the same modal (mirrors the old
    // navigate-to-the-new-record's-edit-page behavior); an existing structure's save closes it.
    setModalTarget((prev) => (prev === 'new' ? id : null));
  }

  const { data = [], isLoading } = useQuery<StructureListItem[]>({
    queryKey: ['setup/salary-structures', 'full'],
    queryFn: () => fetch('/api/setup/salary-structures?full=1').then((r) => r.json()),
  });

  // SAL-006: this only deactivates (structure_active = 0) — it never deletes the row, matching
  // legacy's own soft-delete behavior. Labeled/confirmed as "Deactivate," not "Delete," so an
  // admin isn't misled into thinking the record is gone (it stays editable/reactivatable via
  // the Status field on the Edit page).
  const deactivate = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/setup/salary-structures/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Deactivate failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup/salary-structures'] });
      setDeactivateConfirm(null);
      setError(null);
    },
    onError: (err) => setError(String(err instanceof Error ? err.message : err)),
  });

  const filtered = data
    .filter((row) => !search || row.structure_name.toLowerCase().includes(search.toLowerCase()))
    .filter((row) => !activeOnly || row.structure_active === 1);

  const columns: ColumnDef<StructureListItem, unknown>[] = [
    { accessorKey: 'structure_name', header: 'Name', cell: ({ getValue }) => <span className="font-medium text-gray-800">{String(getValue())}</span> },
    { accessorKey: 'structure_eg_amt', header: 'Example Gross', cell: ({ getValue }) => formatCurrency(Number(getValue())) },
    { accessorKey: 'fixed_days', header: 'Fixed Days' },
    {
      accessorKey: 'structure_active',
      header: 'Status',
      cell: ({ getValue }) => (
        <span className={getValue() ? 'text-emerald-600' : 'text-gray-400'}>
          {getValue() ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setPreviewTarget(row.original.structure_id)}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-indigo-600 transition-colors"
            title="Preview breakup"
          >
            <Calculator className="w-4 h-4" />
          </button>
          <button
            onClick={() => setModalTarget(row.original.structure_id)}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-indigo-600 transition-colors"
            title="Edit"
          >
            <Pencil className="w-4 h-4" />
          </button>
          {row.original.structure_active === 1 && (
            deactivateConfirm === row.original.structure_id ? (
              <span className="flex items-center gap-1 text-xs">
                <button onClick={() => deactivate.mutate(row.original.structure_id)} className="text-red-600 hover:underline">
                  Confirm
                </button>
                <span className="text-gray-400">·</span>
                <button onClick={() => setDeactivateConfirm(null)} className="text-gray-500 hover:underline">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setDeactivateConfirm(row.original.structure_id)}
                className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-red-600 transition-colors"
                title="Deactivate (structure stays editable; reactivate via Status on Edit)"
              >
                <PowerOff className="w-4 h-4" />
              </button>
            )
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-4">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <label className="flex items-center gap-1.5 text-sm text-gray-600 whitespace-nowrap">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
              className="rounded border-gray-300"
            />
            Active only
          </label>
        </div>

        <button
          onClick={() => setModalTarget('new')}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add New
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <DataTable data={filtered} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />

      <Modal open={modalTarget !== null} onClose={() => setModalTarget(null)} className="max-w-6xl">
        {modalTarget !== null && (
          <SalaryStructureForm
            structureId={modalTarget === 'new' ? undefined : modalTarget}
            onBack={() => setModalTarget(null)}
            showBackLink={false}
            onSaved={handleSaved}
          />
        )}
      </Modal>

      <Modal open={previewTarget !== null} onClose={() => setPreviewTarget(null)} className="max-w-2xl">
        {previewTarget !== null && <SalaryStructurePreview structureId={previewTarget} />}
      </Modal>
    </div>
  );
}
