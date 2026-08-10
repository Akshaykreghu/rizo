'use client';

import { Fragment, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Calculator, AlertTriangle, Wand2, Pencil } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { evaluateSalaryFormula, formatFormulaForDisplay } from '@/lib/salaryFormula';
import { FormulaBuilder } from './FormulaBuilder';

interface BuildableItem {
  salary_head_item_pkey: number;
  item: string;
  item_type: string;
  head_fkey: number;
  head_desc: string;
  head_operator: string;
  salary_head_order1: number;
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
  structure_det_calequation: string | null;
}

interface BreakupLine {
  head_name: string;
  amount: number;
  is_deduction: 'Y' | 'N';
  head_desc: string;
  is_employer_contribution: boolean;
  formula_warning: string | null;
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
const UNCATEGORIZED = 'Pick an item…';

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
    defined_structure_for: '', structure_eg_amt: '',
    structure_active: '1',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Starts empty, not with one blank/uncategorized starter row — every real category already
  // has its own "Add to X" button (SAL-022), so a generic catch-all row no longer serves a
  // purpose and was confusing admins about which category a component added there lands in.
  const [rows, setRows] = useState<DetailRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previewGross, setPreviewGross] = useState('');
  const [preview, setPreview] = useState<{ data: BreakupLine[]; net: number; employer_cost: number } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [builderRowKey, setBuilderRowKey] = useState<string | null>(null);
  const [rawEditRows, setRawEditRows] = useState<Set<string>>(new Set());

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
      structure_active: String(s.structure_active ?? '1'),
    });
    if (existing.details.length) {
      setRows(existing.details.map((d) => ({
        key: String(d.structure_det_id),
        salary_head_item_fkey: d.salary_head_item_fkey,
        structure_det_operator: d.structure_det_operator,
        structure_det_value: String(d.structure_det_value ?? ''),
        structure_det_depends: d.structure_det_depends != null ? String(d.structure_det_depends) : '',
        // SAL-012: structure_det_calequation is the real, working formula the engine
        // actually evaluates — structure_formula is a separate, display-only column that can
        // drift out of sync (every pre-existing migrated row had stale legacy English text
        // here, e.g. "Monthly Gross Salary * . 40", even though its calequation was already
        // correct). Seeding the editable field from the stale column would silently
        // re-corrupt a working formula on next save.
        formula: d.structure_det_calequation ?? d.structure_formula ?? '',
      })));
    }
    // SAL-004: show a live breakdown immediately using the structure's own example gross,
    // instead of requiring a manual gross entry + Calculate click before anything is visible.
    if (!previewGross && s.structure_eg_amt) {
      setPreviewGross(String(s.structure_eg_amt));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);

  function validateHeader(): boolean {
    const errs: Record<string, string> = {};
    if (!header.structure_name.trim()) errs.structure_name = 'This value is required.';
    if (!header.structure_eg_amt || Number(header.structure_eg_amt) <= 0) errs.structure_eg_amt = 'This value is required.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...header,
        fixed_days: Number(header.fixed_days) || 30,
        structure_eg_amt: Number(header.structure_eg_amt) || 0,
        structure_active: Number(header.structure_active) || 0,
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
      if (!res.ok) {
        let message = 'Save failed';
        try { message = (await res.json()).error ?? message; } catch { /* non-JSON error body */ }
        throw new Error(message);
      }
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
    onSuccess: (data) => { setPreview(data); setPreviewError(null); },
    onError: (err) => setPreviewError(String(err instanceof Error ? err.message : err)),
  });

  // Auto-runs once the structure and its example gross have loaded (SAL-004).
  useEffect(() => {
    if (isEdit && previewGross && !preview && !runPreview.isPending) {
      runPreview.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewGross]);

  const itemByPkey = new Map(items.map((i) => [i.salary_head_item_pkey, i]));

  // Admin-facing formula display never shows raw `<pkey>_<Item_Name>` tokens — this maps
  // each token back to the item's real name, e.g. "84_EPF_-_Employee_Contribution" -> "EPF -
  // Employee Contribution".
  const tokenLabelMap: Record<string, string> = {};
  for (const i of items) tokenLabelMap[buildToken(i.salary_head_item_pkey, i.item)] = i.item.trim();

  // Best-effort values for the Formula Builder's live preview — only Fixed/Manually rows have
  // a known value before save (formula-driven rows are resolved in save order server-side), so
  // a formula referencing an unset item just can't preview yet, same as it can't evaluate yet.
  const knownItemValues: Record<string, number> = {};
  for (const r of rows) {
    if (r.salary_head_item_fkey === '') continue;
    if (r.structure_det_operator !== 'fixed' && r.structure_det_operator !== 'manually') continue;
    const item = itemByPkey.get(Number(r.salary_head_item_fkey));
    if (!item) continue;
    knownItemValues[buildToken(Number(r.salary_head_item_fkey), item.item)] = Number(r.structure_det_value) || 0;
  }

  // UX: a live "remaining to allocate" estimate against the SAL-019 save-time check, so an
  // admin finds out they're short before clicking Save, not after. Best-effort only — a
  // formula referencing an item added later in the list can't be evaluated yet client-side,
  // same limitation as the Formula Builder's own live preview.
  const exampleGross = Number(header.structure_eg_amt) || 0;
  let monthlySalaryKnownTotal = 0;
  let hasRembalanceRow = false;
  let hasUnresolvedFormula = false;
  for (const r of rows) {
    if (r.salary_head_item_fkey === '') continue;
    const item = itemByPkey.get(Number(r.salary_head_item_fkey));
    if (!item || item.head_fkey !== 1) continue;
    if (r.structure_det_operator === 'rembalance') {
      hasRembalanceRow = true;
    } else if (r.structure_det_operator === 'fixed' || r.structure_det_operator === 'manually') {
      monthlySalaryKnownTotal += Number(r.structure_det_value) || 0;
    } else {
      try {
        monthlySalaryKnownTotal += evaluateSalaryFormula(r.formula, knownItemValues, exampleGross);
      } catch {
        hasUnresolvedFormula = true;
      }
    }
  }
  const remainingToAllocate = exampleGross - monthlySalaryKnownTotal;

  // SAL-003: components grouped into their real salary-head categories (all of them, not a
  // hardcoded subset) instead of one flat 50+ item dropdown with no structure.
  const categoriesInOrder = Array.from(
    new Map(items.map((i) => [i.head_desc, i.salary_head_order1])).entries()
  ).sort((a, b) => a[1] - b[1]).map(([desc]) => desc);

  function rowCategory(row: DetailRow): string {
    if (row.salary_head_item_fkey === '') return UNCATEGORIZED;
    return itemByPkey.get(Number(row.salary_head_item_fkey))?.head_desc ?? UNCATEGORIZED;
  }

  // UX: items already added elsewhere in the structure are hidden from every *other* row's
  // picker — migrated data has real duplicate-item cases (structure 35 has two separate
  // "Dearness Allowance" entries, one never populated) that this makes much harder to repeat
  // by accident. A row's own current selection always stays visible in its own dropdown.
  const usedItemPkeys = new Set(rows.filter((r) => r.salary_head_item_fkey !== '').map((r) => Number(r.salary_head_item_fkey)));

  const rowsByCategory = new Map<string, DetailRow[]>();
  for (const row of rows) {
    const cat = rowCategory(row);
    if (!rowsByCategory.has(cat)) rowsByCategory.set(cat, []);
    rowsByCategory.get(cat)!.push(row);
  }
  // SAL-022: every real category always gets a section + "Add to X" button, regardless of
  // whether it has any rows yet — previously only categories that already had a row were shown,
  // which meant adding the first component (any category) permanently locked out every other
  // category, since there was no way to ever reach their "Add" button again.
  const sectionOrder = [
    ...categoriesInOrder,
    ...(rowsByCategory.has(UNCATEGORIZED) ? [UNCATEGORIZED] : []),
  ];

  // Mirrors the edit form's own category sections above it, instead of one long flat list an
  // admin has to mentally re-group by scanning for the "Employer cost" tag / red deduction text.
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

  function updateRow(key: string, patch: Partial<DetailRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }
  function addRowToCategory(category: string) {
    const candidates = category === UNCATEGORIZED ? [] : items.filter((i) => i.head_desc === category);
    const firstItem = candidates.find((i) => !usedItemPkeys.has(i.salary_head_item_pkey));
    setRows((rs) => [...rs, { ...newRow(), salary_head_item_fkey: firstItem?.salary_head_item_pkey ?? '' }]);
  }

  function renderRow(row: DetailRow) {
    const usesFormula = FORMULA_OPERATORS.has(row.structure_det_operator);
    const usesLimitValue = row.structure_det_operator === 'limit';
    const usesDepends = row.structure_det_operator === 'limit_wl' || row.structure_det_operator === 'limit_wg';
    const category = rowCategory(row);
    const categoryItems = (category === UNCATEGORIZED ? items : items.filter((i) => i.head_desc === category))
      .filter((i) => i.salary_head_item_pkey === Number(row.salary_head_item_fkey) || !usedItemPkeys.has(i.salary_head_item_pkey));

    return (
      <div key={row.key} className="border border-gray-100 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <select
            value={row.salary_head_item_fkey}
            onChange={(e) => updateRow(row.key, { salary_head_item_fkey: e.target.value ? Number(e.target.value) : '' })}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">Select item…</option>
            {categoryItems.map((i) => (
              <option key={i.salary_head_item_pkey} value={i.salary_head_item_pkey}>{i.item.trim()}</option>
            ))}
          </select>
          <select
            value={row.structure_det_operator}
            onChange={(e) => updateRow(row.key, { structure_det_operator: e.target.value })}
            className="w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={() => removeRow(row.key)} className="p-2 text-gray-400 hover:text-red-600">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {row.structure_det_operator === 'rembalance' && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
            This is auto-computed as Gross minus other Monthly Salary Components at calculation time —
            the Amount below is not used and can be left as-is.
          </p>
        )}

        <div className="flex items-center gap-2">
          {usesLimitValue && (
            <input
              type="number"
              value={row.structure_det_value}
              onChange={(e) => updateRow(row.key, { structure_det_value: e.target.value })}
              placeholder="Value (compared against the formula below)"
              className="w-56 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          )}
          {!usesFormula && !usesLimitValue && (
            <input
              type="number"
              value={row.structure_det_value}
              onChange={(e) => updateRow(row.key, { structure_det_value: e.target.value })}
              placeholder="Amount"
              className="w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          )}
        </div>

        {usesFormula && (
          <div>
            {rawEditRows.has(row.key) ? (
              <div className="flex items-center gap-2">
                <input
                  value={row.formula}
                  onChange={(e) => updateRow(row.key, { formula: e.target.value })}
                  placeholder="e.g. monthsal * . 4   or   ( monthsal - ( 1_Basic * . 2 ) ) * . 12"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setRawEditRows((s) => { const n = new Set(s); n.delete(row.key); return n; })}
                  className="px-2.5 py-2 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 whitespace-nowrap"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div
                  className={`flex-1 px-3 py-2 border border-gray-200 bg-gray-50 rounded-lg text-sm ${row.formula ? 'text-gray-700' : 'text-gray-400 italic'}`}
                >
                  {row.formula ? formatFormulaForDisplay(row.formula, tokenLabelMap) : 'No formula set'}
                </div>
                <button
                  type="button"
                  onClick={() => setBuilderRowKey(row.key)}
                  title="Open Formula Builder"
                  className="flex items-center gap-1 px-2.5 py-2 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-gray-50 whitespace-nowrap"
                >
                  <Wand2 className="w-3.5 h-3.5" /> Builder
                </button>
              </div>
            )}
            {row.formula && (() => {
              try {
                const value = evaluateSalaryFormula(row.formula, knownItemValues, exampleGross);
                return <p className="text-xs text-emerald-600 mt-1">= {formatCurrency(value)} at the current example gross</p>;
              } catch {
                return <p className="text-xs text-amber-600 mt-1">Can&apos;t compute live yet — references an item with no value set, or isn&apos;t valid syntax</p>;
              }
            })()}
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-2">
              <span>
                Built from Monthly Gross Salary, numbers, and other components — evaluated once at save
                time using the example gross above.
                {usesLimitValue && ' The smaller of this and the Value field above is used.'}
              </span>
              {!rawEditRows.has(row.key) && (
                <button
                  type="button"
                  onClick={() => setRawEditRows((s) => new Set(s).add(row.key))}
                  className="inline-flex items-center gap-0.5 text-gray-400 hover:text-gray-600 whitespace-nowrap"
                >
                  <Pencil className="w-3 h-3" /> Edit as text
                </button>
              )}
            </p>
          </div>
        )}

        {usesDepends && (
          <input
            type="number"
            value={row.structure_det_depends}
            onChange={(e) => updateRow(row.key, { structure_det_depends: e.target.value })}
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
  }

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
            {fieldErrors.structure_name && <p className="text-xs text-red-500 mt-1">{fieldErrors.structure_name}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Example Monthly Gross *</label>
            <input type="number" value={header.structure_eg_amt} onChange={(e) => setHeader((h) => ({ ...h, structure_eg_amt: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <p className="text-xs text-gray-400 mt-1">Used to derive each formula item&apos;s percentage-of-gross.</p>
            {fieldErrors.structure_eg_amt && <p className="text-xs text-red-500 mt-1">{fieldErrors.structure_eg_amt}</p>}
            {exampleGross > 0 && rows.some((r) => r.salary_head_item_fkey !== '') && (
              <p className={`text-xs mt-1 ${Math.abs(remainingToAllocate) < 0.01 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {Math.abs(remainingToAllocate) < 0.01
                  ? 'Monthly Salary Components fully allocated.'
                  : `Remaining to allocate: ${formatCurrency(remainingToAllocate)}`}
                {hasRembalanceRow && ' (a Remaining Balance component will absorb this)'}
                {hasUnresolvedFormula && ' — some formulas can’t be estimated live yet'}
              </p>
            )}
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
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Description / Defined For</label>
            <input value={header.defined_structure_for} onChange={(e) => setHeader((h) => ({ ...h, defined_structure_for: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          {isEdit && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select value={header.structure_active} onChange={(e) => setHeader((h) => ({ ...h, structure_active: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 max-w-5xl space-y-6">
        <h2 className="text-lg font-semibold text-gray-900">Components</h2>

        {sectionOrder.map((category) => (
          <div key={category}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">{category}</h3>
              <button
                onClick={() => addRowToCategory(category)}
                className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800"
              >
                <Plus className="w-3.5 h-3.5" /> Add to {category === UNCATEGORIZED ? 'structure' : category}
              </button>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              {(rowsByCategory.get(category) ?? []).map(renderRow)}
              {!rowsByCategory.has(category) && (
                <p className="text-xs text-gray-400">No components added yet.</p>
              )}
            </div>
          </div>
        ))}

        {sectionOrder.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <button
              onClick={() => addRowToCategory(UNCATEGORIZED)}
              className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800"
            >
              <Plus className="w-4 h-4" /> Add Component
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 max-w-5xl bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      <div className="mt-6 flex gap-3">
        <button
          onClick={() => { if (validateHeader()) save.mutate(); }}
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
      )}

      <FormulaBuilder
        open={builderRowKey !== null}
        onClose={() => setBuilderRowKey(null)}
        items={items}
        initialFormula={rows.find((r) => r.key === builderRowKey)?.formula ?? ''}
        itemValues={knownItemValues}
        exampleGross={Number(header.structure_eg_amt) || 0}
        onInsert={(formula) => {
          if (builderRowKey) updateRow(builderRowKey, { formula });
        }}
      />
    </div>
  );
}
