'use client';

import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calculator, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface BreakupLine {
  head_name: string;
  amount: number;
  is_deduction: 'Y' | 'N';
  head_desc: string;
  is_employer_contribution: boolean;
  formula_warning: string | null;
}

interface BuildableItem {
  salary_head_item_pkey: number;
  item: string;
  head_desc: string;
  salary_head_order1: number;
}

type Breakup = { data: BreakupLine[]; net: number; employer_cost: number };

/**
 * Read-only "Preview Breakup" for a saved salary structure — split out of SalaryStructureForm
 * into its own modal so it no longer shares screen space with the editor and never looks like
 * it reflects unsaved edits (it hits the /breakup endpoint, which reads the DB). No save button.
 *
 * The gross is always the structure's own saved Example Monthly Gross (structure_eg_amt) — no
 * manual entry. A structure with no gross set (0) simply has nothing to compute.
 */
export function SalaryStructurePreview({ structureId }: { structureId: number }) {
  const { data: existing } = useQuery<{ structure: Record<string, unknown>; details: unknown[] }>({
    queryKey: ['setup/salary-structures', structureId],
    queryFn: () => fetch(`/api/setup/salary-structures/${structureId}`).then((r) => r.json()),
  });

  const { data: items = [] } = useQuery<BuildableItem[]>({
    queryKey: ['setup/salary-head-items', 'buildable'],
    queryFn: () => fetch('/api/setup/salary-head-items?buildable=1').then((r) => r.json()),
  });

  const gross = Number(existing?.structure?.structure_eg_amt) || 0;
  const structureName = String(existing?.structure?.structure_name ?? '');

  const { data: preview, isLoading, error } = useQuery<Breakup>({
    queryKey: ['setup/salary-structures', structureId, 'breakup', gross],
    queryFn: async () => {
      const res = await fetch(`/api/setup/salary-structures/${structureId}/breakup?gross=${gross}`);
      if (!res.ok) throw new Error((await res.json()).error ?? 'Preview failed');
      return res.json();
    },
    enabled: gross > 0,
  });

  const categoriesInOrder = Array.from(
    new Map(items.map((i) => [i.head_desc, i.salary_head_order1])).entries()
  )
    .sort((a, b) => a[1] - b[1])
    .map(([desc]) => desc);

  const previewByCategory = new Map<string, BreakupLine[]>();
  for (const row of preview?.data ?? []) {
    const cat = row.head_desc || 'Other';
    if (!previewByCategory.has(cat)) previewByCategory.set(cat, []);
    previewByCategory.get(cat)!.push(row);
  }
  const previewCategoryOrder = [
    ...categoriesInOrder.filter((c) => previewByCategory.has(c)),
    ...Array.from(previewByCategory.keys()).filter((c) => !categoriesInOrder.includes(c)),
  ];

  return (
    <div className="-m-6 flex flex-col max-h-[calc(90vh-3rem)]">
      <div className="flex-shrink-0 bg-white/95 backdrop-blur-sm border-b border-slate-100 px-6 pt-6 pb-4 rounded-t-2xl pr-14">
        <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <Calculator className="w-4 h-4" /> Preview Breakup
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {structureName && <span>{structureName} · </span>}
          {gross > 0
            ? `at the structure's monthly gross of ${formatCurrency(gross)}`
            : 'no monthly gross set on this structure'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {gross <= 0 && (
          <p className="text-sm text-gray-500">
            This structure has no saved Example Monthly Gross, so there is nothing to compute. Set one
            on the Edit form to see a breakdown here.
          </p>
        )}

        {gross > 0 && isLoading && <p className="text-sm text-gray-400">Calculating…</p>}

        {error && <p className="text-sm text-red-500">{String(error instanceof Error ? error.message : error)}</p>}

        {preview && (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {previewCategoryOrder.map((category) => {
                const rows = previewByCategory.get(category)!;
                const subtotal = rows.reduce((sum, r) => sum + r.amount, 0);
                return (
                  <Fragment key={category}>
                    <tr>
                      <td colSpan={2} className="pt-3 pb-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {category}
                      </td>
                    </tr>
                    {rows.map((row, i) => (
                      <tr key={`${category}-${i}`}>
                        <td className="py-1.5 pl-2 text-gray-700">
                          {row.head_name}
                          {row.is_employer_contribution && (
                            <span className="ml-1.5 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                              Employer cost
                            </span>
                          )}
                          {row.formula_warning && (
                            <span title={row.formula_warning} className="ml-1.5 inline-flex text-amber-500">
                              <AlertTriangle className="w-3 h-3 inline" />
                            </span>
                          )}
                        </td>
                        <td className={`py-1.5 text-right ${row.is_deduction === 'Y' ? 'text-red-600' : 'text-gray-800'}`}>
                          {formatCurrency(row.amount)}
                        </td>
                      </tr>
                    ))}
                    {rows.length > 1 && (
                      <tr key={`${category}-subtotal`} className="text-xs text-gray-500">
                        <td className="py-1 pl-2">Subtotal</td>
                        <td className="py-1 text-right">{formatCurrency(subtotal)}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              <tr className="font-semibold">
                <td className="py-1.5 text-gray-900">Net (employee take-home)</td>
                <td className="py-1.5 text-right text-gray-900">{formatCurrency(preview.net)}</td>
              </tr>
              {preview.employer_cost !== 0 && (
                <tr className="text-xs text-gray-500">
                  <td className="py-1 text-gray-500">Employer contributions (not included above)</td>
                  <td className="py-1 text-right text-gray-500">{formatCurrency(preview.employer_cost)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
