'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';

interface ShiftListItem {
  day_time_seq: number;
  day_time_desc: string;
  active: number;
  isnextday: number;
  ot_eligibility_threshold: string;
  minuts_calc_perday: number;
}

export default function ShiftsPage() {
  const queryClient = useQueryClient();
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { data = [], isLoading } = useQuery<ShiftListItem[]>({
    queryKey: ['setup/shifts'],
    queryFn: () => fetch('/api/setup/shifts').then((r) => r.json()),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/setup/shifts/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup/shifts'] });
      setDeleteConfirm(null);
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Shifts</h1>
        <Link
          href="/setup/shifts/new"
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add New
        </Link>
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Active</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Next Day</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Minutes/Day</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No shifts found. Add one to get started.
                  </td>
                </tr>
              )}
              {data.map((row) => (
                <tr key={row.day_time_seq} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">{row.day_time_desc}</td>
                  <td className="px-4 py-3 text-gray-800">{row.active ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3 text-gray-800">{row.isnextday ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3 text-gray-800">{row.minuts_calc_perday}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/setup/shifts/${row.day_time_seq}`}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-indigo-600 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </Link>
                      {deleteConfirm === row.day_time_seq ? (
                        <span className="flex items-center gap-1 text-xs">
                          <button
                            onClick={() => remove.mutate(row.day_time_seq)}
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
                          onClick={() => setDeleteConfirm(row.day_time_seq)}
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
