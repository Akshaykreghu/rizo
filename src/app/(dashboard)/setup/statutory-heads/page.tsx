'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

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
  const { slotEl } = useHeaderSlot();
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

  if (isLoading) return <div className="text-slate-500 text-[12.5px]">Loading...</div>;

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Statutory Heads
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Map statutory report labels to salary head items, for PF/ESI/PT/TDS reports
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-2xl overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Statutory Label</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Mapped Salary Head Item</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Upper Limit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((row) => (
              <tr key={row.tax_salary_components_pkey} className="hover:bg-slate-50/70">
                <td className="px-4 py-2 text-[#0F172A]">{row.tax_salary_components_name}</td>
                <td className="px-4 py-2">
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
                    className={cn(INPUT_CLASS, 'w-full')}
                  >
                    <option value="">[--Not mapped--]</option>
                    {items.map((i) => (
                      <option key={i.salary_head_item_pkey} value={i.salary_head_item_pkey}>{i.item.trim()}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
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
                    className={cn(INPUT_CLASS, 'w-32')}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {save.isError && <p className="text-[color:var(--color-danger)] text-[12.5px] mt-3">{String(save.error)}</p>}

      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          {save.isPending ? 'Saving…' : 'Save Mapping'}
        </button>
        {saved && <span className="text-[color:var(--color-success-dark)] text-[12.5px]">Saved successfully.</span>}
      </div>
    </div>
  );
}
