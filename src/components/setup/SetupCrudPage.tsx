'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { DataTable } from '@/components/data-table/DataTable';

export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'number' | 'select' | 'checkbox';
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

interface SetupCrudPageProps {
  title: string;
  apiPath: string;
  fields: FieldDef[];
  primaryKey: string;
  displayKey: string;
  columns?: { key: string; label: string }[];
  queryParams?: Record<string, string>;
  /** Hide the page-level <h1> — set when this is rendered as a tab under a page title shown elsewhere. */
  hideTitle?: boolean;
}

const INPUT_CLASS =
  'w-full px-3.5 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-[#0F172A] hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)]/60 transition-colors duration-150';

export function SetupCrudPage({
  title, apiPath, fields, primaryKey, displayKey, columns, queryParams, hideTitle,
}: SetupCrudPageProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const cols = columns ?? [{ key: displayKey, label: title.replace(' Management', '') }];
  const qs = queryParams ? `?${new URLSearchParams(queryParams).toString()}` : '';
  const itemLabel = title.replace(' Management', '');

  const { data = [], isLoading } = useQuery<Record<string, unknown>[]>({
    queryKey: [apiPath, queryParams],
    queryFn: () => fetch(`/api/${apiPath}${qs}`).then((r) => r.json()),
  });

  const save = useMutation({
    mutationFn: async (row: Record<string, string>) => {
      const id = editing?.[primaryKey];
      const url = id ? `/api/${apiPath}/${id}` : `/api/${apiPath}${qs}`;
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [apiPath] });
      closeModal();
    },
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/${apiPath}/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [apiPath] });
      setDeleteConfirm(null);
    },
  });

  function openNew() {
    const f: Record<string, string> = {};
    fields.forEach((field) => { if (field.type === 'checkbox') f[field.key] = 'N'; });
    setForm(f);
    setEditing(null);
    setIsNew(true);
  }

  function openEdit(row: Record<string, unknown>) {
    const f: Record<string, string> = {};
    fields.forEach((field) => {
      const raw = row[field.key];
      if (field.type === 'checkbox') {
        f[field.key] = raw === 'Y' || raw === '1' || raw === 1 || raw === true ? 'Y' : 'N';
      } else if (field.type === 'date' && raw) {
        f[field.key] = String(raw).slice(0, 10);
      } else {
        f[field.key] = String(raw ?? '');
      }
    });
    setForm(f);
    setEditing(row);
    setIsNew(false);
  }

  function closeModal() {
    setEditing(null);
    setIsNew(false);
    setForm({});
  }

  const showModal = isNew || editing !== null;

  const tableColumns: ColumnDef<Record<string, unknown>, unknown>[] = [
    {
      id: 'slNo',
      header: '',
      meta: { className: 'w-12' },
      cell: ({ row, table }) => {
        const { pageIndex, pageSize } = table.getState().pagination;
        return <span className="text-slate-400">{pageIndex * pageSize + row.index + 1}</span>;
      },
    },
    ...cols.map(
      (col): ColumnDef<Record<string, unknown>, unknown> => ({
        id: col.key,
        header: col.label,
        accessorFn: (row) => row[col.key],
        cell: ({ getValue }) => String(getValue() ?? ''),
      })
    ),
    {
      id: 'actions',
      header: '',
      meta: { className: 'w-24' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(row.original); }}
            aria-label={`Edit ${itemLabel}`}
            className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          {deleteConfirm === (row.original[primaryKey] as number) ? (
            <span className="flex items-center gap-1.5 text-xs pl-1">
              <button
                onClick={(e) => { e.stopPropagation(); remove.mutate(row.original[primaryKey] as number); }}
                className="font-medium text-[color:var(--color-danger)] hover:underline"
              >
                Confirm
              </button>
              <span className="text-slate-300">·</span>
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }}
                className="text-slate-500 hover:underline"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteConfirm(row.original[primaryKey] as number); }}
              aria-label={`Delete ${itemLabel}`}
              className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className={cn('flex items-center gap-3 mb-5', hideTitle ? 'justify-end' : 'justify-between')}>
        {!hideTitle && <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight">{title}</h1>}
        <button
          onClick={openNew}
          className="inline-flex items-center gap-2 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-colors duration-150"
        >
          <Plus className="w-4 h-4" />
          Add New
        </button>
      </div>

      <DataTable
        data={data}
        columns={tableColumns}
        pageSize={10}
        pageSizeOptions={[10, 20, 30, 50]}
        isLoading={isLoading}
      />

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={closeModal}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">
                {isNew ? `New ${itemLabel}` : `Edit ${itemLabel}`}
              </h2>
              <button onClick={closeModal} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(form);
              }}
              className="space-y-4"
            >
              {fields.map((field) => (
                <div key={field.key}>
                  {field.type === 'checkbox' ? (
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={form[field.key] === 'Y'}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, [field.key]: e.target.checked ? 'Y' : 'N' }))
                        }
                        className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40"
                      />
                      {field.label}
                    </label>
                  ) : (
                    <>
                      <label className="block text-[13px] font-medium text-slate-600 mb-1.5">
                        {field.label}
                        {field.required && <span className="text-[color:var(--color-danger)]"> *</span>}
                      </label>
                      {field.type === 'select' ? (
                        <select
                          required={field.required}
                          value={form[field.key] ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                          className={INPUT_CLASS}
                        >
                          <option value="">Select…</option>
                          {field.options?.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={field.type === 'date' || field.type === 'number' ? field.type : 'text'}
                          required={field.required}
                          placeholder={field.placeholder}
                          value={form[field.key] ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                          className={INPUT_CLASS}
                        />
                      )}
                    </>
                  )}
                </div>
              ))}

              {save.isError && (
                <p className="text-[color:var(--color-danger)] text-[12.5px]">{String(save.error)}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={save.isPending}
                  className={cn(
                    'px-4 py-2.5 text-sm font-semibold text-white rounded-xl shadow-sm transition-colors duration-150',
                    save.isPending
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
    </div>
  );
}
