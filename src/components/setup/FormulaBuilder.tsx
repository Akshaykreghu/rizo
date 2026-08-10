'use client';

import { useEffect, useState } from 'react';
import { X, Delete, CheckCircle2, AlertCircle } from 'lucide-react';
import { buildItemToken, evaluateSalaryFormula, formatFormulaForDisplay, FormulaError } from '@/lib/salaryFormula';
import { formatCurrency } from '@/lib/utils';

interface FormulaBuilderItem {
  salary_head_item_pkey: number;
  item: string;
}

// Mirrors legacy's formula-builder modal (legacy/View/SalaryStructure/form.ctp:970-1079) —
// same "Monthly Gross Salary" -> monthsal / item -> <pkey>_<ItemName> token mapping, same
// digit/operator keypad. Builds the raw token string directly (one array entry per button
// press, space-joined) instead of legacy's parallel display-vs-stored-value tracking; the
// human-readable rendering shown to the admin is derived from the raw tokens via
// formatFormulaForDisplay, so there's one source of truth, not two to keep in sync.
const DIGITS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.'];
const OPERATORS = ['+', '-', '*', '/', '(', ')'];

export function FormulaBuilder({
  open,
  onClose,
  items,
  initialFormula,
  itemValues,
  exampleGross,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  items: FormulaBuilderItem[];
  initialFormula: string;
  itemValues: Record<string, number>;
  exampleGross: number;
  onInsert: (formula: string) => void;
}) {
  const [tokens, setTokens] = useState<string[]>([]);

  useEffect(() => {
    if (open) setTokens(initialFormula.trim() ? initialFormula.trim().split(/\s+/) : []);
  }, [open, initialFormula]);

  if (!open) return null;

  const rawFormula = tokens.join(' ');
  const labelByToken: Record<string, string> = { monthsal: 'Monthly Gross Salary' };
  for (const i of items) labelByToken[buildItemToken(i.salary_head_item_pkey, i.item)] = i.item.trim();
  const display = formatFormulaForDisplay(rawFormula, labelByToken);

  let preview: { ok: true; value: number } | { ok: false; message: string } | null = null;
  if (rawFormula) {
    try {
      preview = { ok: true, value: evaluateSalaryFormula(rawFormula, itemValues, exampleGross) };
    } catch (err) {
      preview = { ok: false, message: err instanceof FormulaError ? err.message : 'Cannot evaluate yet' };
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Formula Builder</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 mb-4 min-h-[3rem]">
          <p className={`text-sm ${display ? 'text-gray-800' : 'text-gray-400 italic'}`}>
            {display || 'Your formula will appear here as you build it'}
          </p>
        </div>

        {preview && (
          <div className={`flex items-center gap-1.5 text-xs mb-4 -mt-2 ${preview.ok ? 'text-emerald-600' : 'text-amber-600'}`}>
            {preview.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            {preview.ok
              ? <span>≈ {formatCurrency(preview.value)} at the current example gross</span>
              : <span>Can&apos;t preview yet — {preview.message.toLowerCase()}</span>}
          </div>
        )}

        <label className="block text-xs font-medium text-gray-500 mb-1.5">Insert a value</label>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) setTokens((t) => [...t, e.target.value]);
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4"
        >
          <option value="">---Select---</option>
          <option value="monthsal">Monthly Gross Salary</option>
          {items.map((i) => (
            <option key={i.salary_head_item_pkey} value={buildItemToken(i.salary_head_item_pkey, i.item)}>
              {i.item.trim()}
            </option>
          ))}
        </select>

        <label className="block text-xs font-medium text-gray-500 mb-1.5">Build the expression</label>
        <div className="flex gap-3 mb-4">
          <div className="grid grid-cols-3 gap-1.5 flex-1">
            {DIGITS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTokens((t) => [...t, k])}
                className="py-2 rounded-lg border border-gray-200 text-sm font-mono hover:bg-gray-50"
              >
                {k}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5 w-24">
            {OPERATORS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTokens((t) => [...t, k])}
                className="py-2 rounded-lg border border-indigo-100 bg-indigo-50 text-sm font-mono text-indigo-700 hover:bg-indigo-100"
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setTokens((t) => t.slice(0, -1))}
              title="Remove last entry"
              className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
            >
              <Delete className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setTokens([])}
              className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-800"
            >
              Clear All
            </button>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onInsert(rawFormula);
                onClose();
              }}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg transition-colors"
            >
              Ok
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
