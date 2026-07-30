'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface LeaveType {
  salary_head_item_pkey: number;
  item: string;
  occurance: string;
  value: 'Y' | 'N';
}

export default function LeaveTypesPage() {
  const queryClient = useQueryClient();

  const { data = [], isLoading } = useQuery<LeaveType[]>({
    queryKey: ['setup/leave-types'],
    queryFn: () => fetch('/api/setup/leave-types').then((r) => r.json()),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, value }: { id: number; value: 'Y' | 'N' }) => {
      const res = await fetch(`/api/setup/leave-types/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['setup/leave-types'] }),
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Leave Types</h1>
        <p className="text-sm text-gray-500 mt-1">
          Enable the leave types this company uses. Only enabled types are available when building Leave Policies.
        </p>
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Leave Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Code</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Enabled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
                    No leave types found.
                  </td>
                </tr>
              )}
              {data.map((lt) => (
                <tr key={lt.salary_head_item_pkey} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">{lt.item.trim()}</td>
                  <td className="px-4 py-3 text-gray-500">{lt.occurance}</td>
                  <td className="px-4 py-3 text-right">
                    <label className="inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lt.value === 'Y'}
                        onChange={(e) =>
                          toggle.mutate({
                            id: lt.salary_head_item_pkey,
                            value: e.target.checked ? 'Y' : 'N',
                          })
                        }
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </label>
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
