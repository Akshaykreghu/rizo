'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Calculator } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface BuildableItem {
  salary_head_item_pkey: number;
  item: string;
  item_type: string;
  head_fkey: number;
  head_desc: string;
  head_operator: string;
}

interface DetailRow {
  key: string; // client-side row id, not persisted
  salary_head_item_fkey: number | '';
  structure_det_operator: string;
  structure_det_value: string;
  structure_det_depends: string;
  formula: string;
}

interface StructureDetail {
  structure_det_id: number;
  salary_head_item_fkey: number;
  structure_det_operator: string;
  structure_det_value: number;
  structure_det_depends: number | null;
  structure_formula: string | null;
}

const OPERATORS = [
  { value: 'fixed', label: 'Fixed Amount' },
  { value: 'formula', label: 'Formula (% of gross / expression)' },
  { value: 'limit', label: 'Limit (lesser of value or formula)' },
  { value: 'limit_wl', label: 'Limit — With Lower Bound' },
  { value: 'limit_wg', label: 'Limit — With Upper Bound' },
  { value: 'rembalance', label: 'Remaining Balance' },
  { value: 'manually', label: 'Manually Entered' },
];

const FORMULA_OPERATORS = new Set(['formula', 'limit', 'limit_wl', 'limit_wg']);

function buildToken(pkey: number, name: string): string {
  return `${pkey}_${name.trim().replace(/[()&\s]/g, '_')}`;
}

function newRow(): DetailRow {
  return {
    key: Math.random().toString(36).slice(2),
    salary_head_item_fkey: '',
    structure_det_operator: 'fixed',
    structure_det_value: '',
    structure_det_depends: '',
    formula: '',
  };
}

export function SalaryStructureForm({ structureId }: { structureId?: number }) {
  const router = useRouter();
  const isEdit = structureId != null;

  const [header, setHeader] = useState({
    structure_name: '', prorate_code: '', prorate_desc: '', fixed_days: '30',
    defined_structure_for: '', structure_eg_amt: '', startdate_effective: '', enddate_effective: '',
  });
  const [rows, setRows] = useState<DetailRow[]>([newRow()]);
  const [error, setError] = useState<string | null>(null);
  const [previewGross, setPreviewGross] = useState('');
  const [preview, setPreview] = useState<{ head_name: string; amount: number; is_deduction: string }[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const { data: items = [] } = useQuery<BuildableItem[]>({
    queryKey: ['setup/salary-head-items', 'buildable'],
    queryFn: () => fetch('/api/setup/salary-head-items?buildable=1').then((r) => r.json()),
  });

  const { data: existing } = useQuery<{ structure: Record<string, unknown>; details: StructureDetail[] }>({
    queryKey: ['setup/salary-structures', structureId],
    queryFn: () => fetch(`/api/setup/salary-structures/${structureId}`).then((r) => r.json()),
    enabled: isEdit,
  });

  useEffect(() => {
    if (!existing) return;
    const s = existing.structure;
    setHeader({
      structure_name: String(s.structure_name ?? ''),
      prorate_code: String(s.prorate_code ?? ''),
      prorate_desc: String(s.prorate_desc ?? ''),
      fixed_days: String(s.fixed_days ?? '30'),
      defined_structure_for: String(s.defined_structure_for ?? ''),
      structure_eg_amt: String(s.structure_eg_amt ?? ''),
      startdate_effective: String(s.startdate_effective ?? '').slice(0, 10),
      enddate_effective: String(s.enddate_effective ?? '').slice(0, 10),
    });
    if (existing.details.length) {
      setRows(existing.details.map((d) => ({
        key: String(d.structure_det_id),
        salary_head_item_fkey: d.salary_head_item_fkey,
        structure_det_operator: d.structure_det_operator,
        structure_det_value: String(d.structure_det_value ?? ''),
        structure_det_depends: d.structure_det_depends != null ? String(d.structure_det_depends) : '',
        formula: d.structure_formula ?? '',
      })));
    }
  }, [existing]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...header,
        fixed_days: Number(header.fixed_days) || 30,
        structure_eg_amt: Number(header.structure_eg_amt) || 0,
        details: rows
          .filter((r) => r.salary_head_item_fkey !== '')
          .map((r) => ({
            salary_head_item_fkey: Number(r.salary_head_item_fkey),
            structure_det_operator: r.structure_det_operator,
            structure_det_value: Number(r.structure_det_value) || 0,
            structure_det_depends: r.structure_det_depends ? Number(r.structure_det_depends) : null,
            formula: r.formula || undefined,
          })),
      };
      const url = isEdit ? `/api/setup/salary-structures/${structureId}` : '/api/setup/salary-structures';
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      return res.json();
    },
    onSuccess: (data) => {
      setError(null);
      router.push(isEdit ? '/setup/salary-structure' : `/setup/salary-structure/${data.id}`);
    },
    onError: (err) => setError(String(err instanceof Error ? err.message : err)),
  });

  const runPreview = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/setup/salary-structures/${structureId}/breakup?gross=${Number(previewGross) || 0}`);
      if (!res.ok) throw new Error((await res.json()).error ?? 'Preview failed');
      return res.json();
    },
    onSuccess: (data) => { setPreview(data.data); setPreviewError(null); },
    onError: (err) => setPreviewError(String(err instanceof Error ? err.message : err)),
  });

  const itemByPkey = new Map(items.map((i) => [i.salary_head_item_pkey, i]));
  const grouped = items.reduce<Record<string, BuildableItem[]>>((acc, i) => {
    (acc[i.head_desc] ??= []).push(i);
    return acc;
  }, {});

  return (
    <div>
      <button
        onClick={() => router.push('/setup/salary-structure')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-5 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Salary Structures
      </button>

      <h1 className="text-2xl font-semibold text-gray-900 mb-6">
        {isEdit ? 'Edit Salary Structure' : 'New Salary Structure'}
      </h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4 max-w-3xl">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Structure Name *</label>
            <input value={header.structure_name} onChange={(e) => setHeader((h) => ({ ...h, structure_name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Example Monthly Gross *</label>
            <input type="number" value={header.structure_eg_amt} onChange={(e) => setHeader((h) => ({ ...h, structure_eg_amt: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <p className="text-xs text-gray-400 mt-1">Used to derive each formula item&apos;s percentage-of-gross.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Prorate Code</label>
            <input value={header.prorate_code} onChange={(e) => setHeader((h) => ({ ...h, prorate_code: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fixed Days</label>
            <input type="number" value={header.fixed_days} onChange={(e) => setHeader((h) => ({ ...h, fixed_days: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
            <input type="date" value={header.startdate_effective} onChange={(e) => setHeader((h) => ({ ...h, startdate_effective: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label>
            <input type="date" value={header.enddate_effective} onChange={(e) => setHeader((h) => ({ ...h, enddate_effective: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Description / Defined For</label>
            <input value={header.defined_structure_for} onChange={(e) => setHeader((h) => ({ ...h, defined_structure_for: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
      </div>

      <div className="mt-8 max-w-5xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">Components</h2>
          <button
            onClick={() => setRows((r) => [...r, newRow()])}
            className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800"
          >
            <Plus className="w-4 h-4" /> Add Component
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          {rows.map((row, idx) => {
            const usesFormula = FORMULA_OPERATORS.has(row.structure_det_operator);
            const usesDepends = row.structure_det_operator === 'limit_wl' || row.structure_det_operator === 'limit_wg';
            return (
              <div key={row.key} className="border border-gray-100 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={row.salary_head_item_fkey}
                    onChange={(e) => setRows((rs) => rs.map((r, i) => i === idx ? { ...r, salary_head_item_fkey: e.target.value ? Number(e.target.value) : '' } : r))}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">Select item…</option>
                    {Object.entries(grouped).map(([headDesc, groupItems]) => (
                      <optgroup key={headDesc} label={headDesc}>
                        {groupItems.map((i) => (
                          <option key={i.salary_head_item_pkey} value={i.salary_head_item_pkey}>{i.item.trim()}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <select
                    value={row.structure_det_operator}
                    onChange={(e) => setRows((rs) => rs.map((r, i) => i === idx ? { ...r, structure_det_operator: e.target.value } : r))}
                    className="w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <button onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))} className="p-2 text-gray-400 hover:text-red-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {usesFormula ? (
                  <div>
                    <input
                      value={row.formula}
                      onChange={(e) => setRows((rs) => rs.map((r, i) => i === idx ? { ...r, formula: e.target.value } : r))}
                      placeholder="e.g. monthsal * . 4   or   ( monthsal - ( 1_Basic * . 2 ) ) * . 12"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Space-separated tokens: numbers, <code>+ - * / . ( )</code>, <code>monthsal</code> (example gross),
                      or another item&apos;s token below. Evaluated once at save time using the example gross above.
                    </p>
                  </div>
                ) : (
                  <input
                    type="number"
                    value={row.structure_det_value}
                    onChange={(e) => setRows((rs) => rs.map((r, i) => i === idx ? { ...r, structure_det_value: e.target.value } : r))}
                    placeholder="Amount"
                    className="w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                )}

                {usesDepends && (
                  <input
                    type="number"
                    value={row.structure_det_depends}
                    onChange={(e) => setRows((rs) => rs.map((r, i) => i === idx ? { ...r, structure_det_depends: e.target.value } : r))}
                    placeholder={row.structure_det_operator === 'limit_wl' ? 'Lower bound amount' : 'Upper bound amount'}
                    className="w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                )}

                {row.salary_head_item_fkey !== '' && itemByPkey.get(Number(row.salary_head_item_fkey)) && (
                  <p className="text-xs text-gray-400">
                    Token for referencing this item elsewhere: <code className="bg-gray-100 px-1 rounded">
                      {buildToken(Number(row.salary_head_item_fkey), itemByPkey.get(Number(row.salary_head_item_fkey))!.item)}
                    </code>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mt-4 max-w-5xl bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      <div className="mt-6 flex gap-3">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {save.isPending ? 'Saving…' : 'Save Structure'}
        </button>
      </div>

      {isEdit && (
        <div className="mt-10 max-w-2xl">
          <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Calculator className="w-4 h-4" /> Preview Breakup
          </h2>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-end gap-3 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Gross</label>
                <input
                  type="number"
                  value={previewGross}
                  onChange={(e) => setPreviewGross(e.target.value)}
                  className="w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <button
                onClick={() => runPreview.mutate()}
                disabled={runPreview.isPending}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm transition-colors"
              >
                {runPreview.isPending ? 'Calculating…' : 'Calculate'}
              </button>
            </div>
            {previewError && <p className="text-sm text-red-500 mb-2">{previewError}</p>}
            {preview && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {preview.map((row, i) => (
                    <tr key={i}>
                      <td className="py-1.5 text-gray-700">{row.head_name.trim()}</td>
                      <td className={`py-1.5 text-right ${row.is_deduction === 'Y' ? 'text-red-600' : 'text-gray-800'}`}>
                        {formatCurrency(row.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-1.5 text-gray-900">Net</td>
                    <td className="py-1.5 text-right text-gray-900">
                      {formatCurrency(preview.reduce((sum, r) => sum + Number(r.amount), 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
