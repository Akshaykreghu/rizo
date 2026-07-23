'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface StructureListItem {
  structure_id: number;
  structure_name: string;
  structure_eg_amt: number;
  fixed_days: number;
  prorate_code: string;
  structure_active: number;
}

export default function SalaryStructureListPage() {
  const queryClient = useQueryClient();
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data = [], isLoading } = useQuery<StructureListItem[]>({
    queryKey: ['setup/salary-structures', 'full'],
    queryFn: () => fetch('/api/setup/salary-structures?full=1').then((r) => r.json()),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/setup/salary-structures/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup/salary-structures'] });
      setDeleteConfirm(null);
      setError(null);
    },
    onError: (err) => setError(String(err instanceof Error ? err.message : err)),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Salary Structures</h1>
        <Link
          href="/setup/salary-structure/new"
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add New
        </Link>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Example Gross</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Fixed Days</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No salary structures found. Add one to get started.
                  </td>
                </tr>
              )}
              {data.map((row) => (
                <tr key={row.structure_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800 font-medium">{row.structure_name}</td>
                  <td className="px-4 py-3 text-gray-800">{formatCurrency(row.structure_eg_amt)}</td>
                  <td className="px-4 py-3 text-gray-800">{row.fixed_days}</td>
                  <td className="px-4 py-3">
                    <span className={row.structure_active ? 'text-emerald-600' : 'text-gray-400'}>
                      {row.structure_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/setup/salary-structure/${row.structure_id}`}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-indigo-600 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </Link>
                      {deleteConfirm === row.structure_id ? (
                        <span className="flex items-center gap-1 text-xs">
                          <button onClick={() => remove.mutate(row.structure_id)} className="text-red-600 hover:underline">
                            Confirm
                          </button>
                          <span className="text-gray-400">·</span>
                          <button onClick={() => setDeleteConfirm(null)} className="text-gray-500 hover:underline">
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(row.structure_id)}
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
    </div>
  );
}
