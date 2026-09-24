'use client';

import { useState } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { RequiredMark } from '@/components/ui/RequiredMark';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

const SELECT_BUTTON_CLASS = 'w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm';

export interface RepeatableFieldDef {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'number' | 'select' | 'checkbox';
  options?: { value: string; label: string }[];
  required?: boolean;
  /** Max characters (digits, for 'number') — see lib/employeeFieldLimits.ts. No effect on
   *  'select'/'date' fields. */
  maxLength?: number;
  /** 'date' only: key of another date field in the same row that this one can't be earlier
   *  than (e.g. To >= From). Dates before it are disabled in the calendar picker. */
  minFromKey?: string;
  /** Strips disallowed characters as the user types (e.g. digits only) — see lib/childRowValidation.ts. */
  sanitize?: (value: string) => string;
  /** Checked on save; returns an error message for a bad value, or null. */
  validate?: (value: string) => string | null;
  /** Mobile keyboard hint for text fields that only take numbers. */
  inputMode?: 'numeric' | 'decimal';
}

interface RepeatableRowsProps {
  fields: RepeatableFieldDef[];
  rows: Record<string, unknown>[];
  pkeyField: string;
  onAdd: (values: Record<string, string>) => void | Promise<void>;
  onRemove: (pkey: number) => void | Promise<void>;
  /** When given, each saved row gets an Edit button that loads it into the input row below;
   *  saving then updates that same row in place (by pkey) instead of adding a new one. */
  onUpdate?: (pkey: number, values: Record<string, string>) => void | Promise<void>;
  addLabel?: string;
}

export function RepeatableRows({ fields, rows, pkeyField, onAdd, onRemove, onUpdate, addLabel }: RepeatableRowsProps) {
  const empty = Object.fromEntries(fields.map((f) => [f.key, '']));
  const [draft, setDraft] = useState<Record<string, string>>(empty);
  const [adding, setAdding] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [rowError, setRowError] = useState('');
  const [editingPkey, setEditingPkey] = useState<number | null>(null);

  function startEdit(row: Record<string, unknown>) {
    // Date inputs need plain YYYY-MM-DD; some routes return full ISO timestamps (UTC-pinned pool).
    setDraft(Object.fromEntries(fields.map((f) => {
      const v = row[f.key] == null ? '' : String(row[f.key]);
      return [f.key, f.type === 'date' ? v.slice(0, 10) : v];
    })));
    setEditingPkey(Number(row[pkeyField]));
    setBlocked(false);
    setRowError('');
  }

  function cancelEdit() {
    setDraft(empty);
    setEditingPkey(null);
    setBlocked(false);
    setRowError('');
  }

  function setValue(key: string, raw: string) {
    // A number input ignores the maxLength attribute, so cap every limited field here instead.
    const field = fields.find((f) => f.key === key);
    const cleaned = field?.sanitize ? field.sanitize(raw) : raw;
    const value = field?.maxLength ? cleaned.slice(0, field.maxLength) : cleaned;
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      // Changing a "from" date past its dependent "to" date clears the now-invalid "to".
      for (const f of fields) {
        if (f.minFromKey === key && next[f.key] && value && next[f.key] < value) next[f.key] = '';
      }
      return next;
    });
    setRowError('');
  }

  async function handleAdd() {
    if (fields.some((f) => f.required && !draft[f.key]?.trim())) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    for (const f of fields) {
      const message = f.validate && draft[f.key]?.trim() ? f.validate(draft[f.key].trim()) : null;
      if (message) {
        setRowError(message);
        return;
      }
    }
    const badRange = fields.find((f) => f.minFromKey && draft[f.key] && draft[f.minFromKey] && draft[f.key] < draft[f.minFromKey]);
    if (badRange) {
      const fromLabel = fields.find((f) => f.key === badRange.minFromKey)?.label ?? badRange.minFromKey;
      setRowError(`${badRange.label} date can't be before ${fromLabel} date.`);
      return;
    }
    setAdding(true);
    try {
      if (editingPkey != null && onUpdate) await onUpdate(editingPkey, draft);
      else await onAdd(draft);
      setDraft(empty);
      setEditingPkey(null);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  // The row being edited is shown only in the editor below, not repeated in the table.
  const visibleRows = rows.filter((row) => Number(row[pkeyField]) !== editingPkey);

  return (
    <div className="space-y-3">
      {visibleRows.length > 0 && (
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
              {visibleRows.map((row) => (
                <tr key={String(row[pkeyField])} className="border-t border-gray-100">
                  {fields.map((f) => (
                    <td key={f.key} className="py-2 pr-4 text-gray-800">{String(row[f.key] ?? '')}</td>
                  ))}
                  <td className="py-2 whitespace-nowrap">
                    {onUpdate && (
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        className="mr-2.5 text-gray-400 hover:text-indigo-600"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
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

      {/* Labels and inputs are two separate grid rows (not one row of stacked label+input pairs)
          so a long label wrapping to two lines (e.g. "Name on Document") only grows the label
          row — it can no longer push just that one field's input out of line with its neighbors.
          The trailing `auto` column holds a dedicated save icon, lined up with the trash-icon
          column of the saved-rows table above. */}
      <div className="grid gap-x-3 gap-y-1 items-end" style={{ gridTemplateColumns: `repeat(${fields.length}, minmax(0, 1fr)) auto` }}>
        {fields.map((f) => (
          <label key={`${f.key}-label`} className="block text-xs font-medium text-gray-500">
            {f.label}{f.required && <RequiredMark />}
          </label>
        ))}
        <span />
        {fields.map((f) => (
          <div key={`${f.key}-input`}>
            {f.type === 'select' ? (
              <SearchableSelect
                value={draft[f.key]}
                onChange={(v) => setValue(f.key, v)}
                options={f.options ?? []}
                placeholder="Select"
                buttonClassName={SELECT_BUTTON_CLASS}
              />
            ) : (
              <input
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                maxLength={f.maxLength}
                inputMode={f.inputMode}
                min={f.type === 'date' && f.minFromKey ? draft[f.minFromKey] || undefined : undefined}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={draft[f.key]}
                onChange={(e) => setValue(f.key, e.target.value)}
              />
            )}
          </div>
        ))}
        <button
          type="button"
          disabled={adding}
          onClick={handleAdd}
          title={editingPkey != null ? 'Save changes' : (addLabel ?? 'Add row')}
          className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white transition-colors duration-[180ms]"
        >
          <Check className="w-4 h-4" />
        </button>
      </div>
      {blocked && (
        <p className="text-xs text-[color:var(--color-danger)]">Fill in all required fields before saving this row.</p>
      )}
      {rowError && <p className="text-xs text-[color:var(--color-danger)]">{rowError}</p>}
      {editingPkey != null ? (
        <div className="flex items-center gap-3 text-xs">
          <span className="font-medium text-indigo-600">Editing row</span>
          <button type="button" disabled={adding} onClick={handleAdd} className="font-medium text-indigo-600 hover:text-indigo-800 disabled:text-indigo-300">
            Save changes
          </button>
          <button type="button" onClick={cancelEdit} className="font-medium text-gray-500 hover:text-gray-700">
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={adding}
          onClick={handleAdd}
          className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:text-indigo-300"
        >
          <Plus className="w-3.5 h-3.5" /> {addLabel ?? 'Add row'}
        </button>
      )}
    </div>
  );
}
