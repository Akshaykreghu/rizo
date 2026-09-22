'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { RequiredMark } from '@/components/ui/RequiredMark';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

const SELECT_BUTTON_CLASS = 'w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm';

export interface RepeatableFieldDef {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'number' | 'select' | 'checkbox';
  options?: { value: string; label: string }[];
  required?: boolean;
}

interface RepeatableRowsProps {
  fields: RepeatableFieldDef[];
  rows: Record<string, unknown>[];
  pkeyField: string;
  onAdd: (values: Record<string, string>) => void | Promise<void>;
  onRemove: (pkey: number) => void | Promise<void>;
  addLabel?: string;
}

export function RepeatableRows({ fields, rows, pkeyField, onAdd, onRemove, addLabel }: RepeatableRowsProps) {
  const empty = Object.fromEntries(fields.map((f) => [f.key, '']));
  const [draft, setDraft] = useState<Record<string, string>>(empty);
  const [adding, setAdding] = useState(false);
  const [blocked, setBlocked] = useState(false);

  async function handleAdd() {
    if (fields.some((f) => f.required && !draft[f.key]?.trim())) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    setAdding(true);
    try {
      await onAdd(draft);
      setDraft(empty);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                {fields.map((f) => (
                  <th key={f.key} className="pb-2 pr-4 font-medium">{f.label}</th>
                ))}
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row[pkeyField])} className="border-t border-gray-100">
                  {fields.map((f) => (
                    <td key={f.key} className="py-2 pr-4 text-gray-800">{String(row[f.key] ?? '')}</td>
                  ))}
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => onRemove(Number(row[pkeyField]))}
                      className="text-gray-400 hover:text-red-500"
                      title="Remove"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${fields.length}, minmax(0, 1fr))` }}>
        {fields.map((f) => (
          <div key={f.key}>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              {f.label}{f.required && <RequiredMark />}
            </label>
            {f.type === 'select' ? (
              <SearchableSelect
                value={draft[f.key]}
                onChange={(v) => setDraft((prev) => ({ ...prev, [f.key]: v }))}
                options={f.options ?? []}
                placeholder="Select"
                buttonClassName={SELECT_BUTTON_CLASS}
              />
            ) : (
              <input
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={draft[f.key]}
                onChange={(e) => setDraft((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            )}
          </div>
        ))}
      </div>
      {blocked && (
        <p className="text-xs text-[color:var(--color-danger)]">Fill in all required fields before adding this row.</p>
      )}
      <button
        type="button"
        disabled={adding}
        onClick={handleAdd}
        className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:text-indigo-300"
      >
        <Plus className="w-3.5 h-3.5" /> {addLabel ?? 'Add row'}
      </button>
    </div>
  );
}
