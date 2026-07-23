'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

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
}

export function SetupCrudPage({
  title, apiPath, fields, primaryKey, displayKey, columns, queryParams,
}: SetupCrudPageProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const cols = columns ?? [{ key: displayKey, label: title.replace(' Management', '') }];
  const qs = queryParams ? `?${new URLSearchParams(queryParams).toString()}` : '';

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
        <button
          onClick={openNew}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add New
        </button>
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {cols.map((col) => (
                  <th key={col.key} className="text-left px-4 py-3 font-medium text-gray-600">
                    {col.label}
                  </th>
                ))}
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.length === 0 && (
                <tr>
                  <td colSpan={cols.length + 1} className="px-4 py-8 text-center text-gray-400">
                    No records found. Add one to get started.
                  </td>
                </tr>
              )}
              {data.map((row) => (
                <tr key={String(row[primaryKey])} className="hover:bg-gray-50">
                  {cols.map((col) => (
                    <td key={col.key} className="px-4 py-3 text-gray-800">
                      {String(row[col.key] ?? '')}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(row)}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-indigo-600 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {deleteConfirm === (row[primaryKey] as number) ? (
                        <span className="flex items-center gap-1 text-xs">
                          <button
                            onClick={() => remove.mutate(row[primaryKey] as number)}
                            className="text-red-600 hover:underline"
                          >
                            Confirm
                          </button>
                          <span className="text-gray-400">·</span>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-gray-500 hover:underline"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(row[primaryKey] as number)}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeModal} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">
                {isNew ? `New ${title.replace(' Management', '')}` : `Edit ${title.replace(' Management', '')}`}
              </h2>
              <button onClick={closeModal} className="p-1 rounded hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-500" />
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
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                      <input
                        type="checkbox"
                        checked={form[field.key] === 'Y'}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, [field.key]: e.target.checked ? 'Y' : 'N' }))
                        }
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      {field.label}
                    </label>
                  ) : (
                    <>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {field.label}
                        {field.required && <span className="text-red-500 ml-0.5">*</span>}
                      </label>
                      {field.type === 'select' ? (
                        <select
                          required={field.required}
                          value={form[field.key] ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      )}
                    </>
                  )}
                </div>
              ))}

              {save.isError && (
                <p className="text-red-500 text-sm">{String(save.error)}</p>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={save.isPending}
                  className={cn(
                    'px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors',
                    save.isPending
                      ? 'bg-indigo-400'
                      : 'bg-indigo-600 hover:bg-indigo-700'
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
