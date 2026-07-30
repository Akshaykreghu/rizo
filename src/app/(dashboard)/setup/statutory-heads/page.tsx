'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

interface StatutoryHead {
  tax_salary_components_pkey: number;
  tax_salary_components_name: string;
  salary_head_item_Fkey: number | null;
  upper_limit: number;
  mapped_item_name: string | null;
}

interface SalaryHeadItemOption {
  salary_head_item_pkey: number;
  item: string;
}

type RowState = Record<number, { salary_head_item_Fkey: string; upper_limit: string }>;

export default function StatutoryHeadsPage() {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<RowState>({});
  const [saved, setSaved] = useState(false);

  const { data = [], isLoading } = useQuery<StatutoryHead[]>({
    queryKey: ['setup/statutory-heads'],
    queryFn: () => fetch('/api/setup/statutory-heads').then((r) => r.json()),
  });

  const { data: items = [] } = useQuery<SalaryHeadItemOption[]>({
    queryKey: ['setup/salary-head-items', 'buildable'],
    queryFn: () => fetch('/api/setup/salary-head-items?buildable=1').then((r) => r.json()),
  });

  useEffect(() => {
    if (!data.length) return;
    const r: RowState = {};
    data.forEach((row) => {
      r[row.tax_salary_components_pkey] = {
        salary_head_item_Fkey: row.salary_head_item_Fkey != null ? String(row.salary_head_item_Fkey) : '',
        upper_limit: String(row.upper_limit ?? 0),
      };
    });
    setRows(r);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const updates = Object.entries(rows).map(([pkey, v]) => ({
        pkey: Number(pkey),
        salary_head_item_Fkey: v.salary_head_item_Fkey ? Number(v.salary_head_item_Fkey) : null,
        upper_limit: Number(v.upper_limit) || 0,
      }));
      const res = await fetch('/api/setup/statutory-heads', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup/statutory-heads'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  if (isLoading) return <div className="text-gray-500 text-sm">Loading...</div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Statutory Heads</h1>
        <p className="text-sm text-gray-500 mt-1">
          Map each standard statutory report label to the actual salary head item this company uses for it —
          drives PF/ESI/PT/TDS reports.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Statutory Label</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Mapped Salary Head Item</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Upper Limit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.map((row) => (
              <tr key={row.tax_salary_components_pkey} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-800">{row.tax_salary_components_name}</td>
                <td className="px-4 py-3">
                  <select
                    value={rows[row.tax_salary_components_pkey]?.salary_head_item_Fkey ?? ''}
                    onChange={(e) =>
                      setRows((r) => ({
                        ...r,
                        [row.tax_salary_components_pkey]: {
                          ...r[row.tax_salary_components_pkey],
                          salary_head_item_Fkey: e.target.value,
                        },
                      }))
                    }
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">[--Not mapped--]</option>
                    {items.map((i) => (
                      <option key={i.salary_head_item_pkey} value={i.salary_head_item_pkey}>{i.item.trim()}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    step="any"
                    value={rows[row.tax_salary_components_pkey]?.upper_limit ?? '0'}
                    onChange={(e) =>
                      setRows((r) => ({
                        ...r,
                        [row.tax_salary_components_pkey]: {
                          ...r[row.tax_salary_components_pkey],
                          upper_limit: e.target.value,
                        },
                      }))
                    }
                    className="w-32 px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {save.isError && <p className="text-red-500 text-sm mt-3">{String(save.error)}</p>}

      <div className="flex items-center gap-4 mt-4">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className={cn(
            'px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors',
            save.isPending ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700'
          )}
        >
          {save.isPending ? 'Saving…' : 'Save Mapping'}
        </button>
        {saved && <span className="text-green-600 text-sm">Saved successfully.</span>}
      </div>
    </div>
  );
}
