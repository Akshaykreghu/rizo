'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ChevronLeft } from 'lucide-react';

interface FieldOption { key: string; label: string }

// Mirrors legacy's "Employee Information" report's dual-list field picker (37 real fields,
// available → selected, confirmed via live UI walkthrough) — lets the user choose which output
// columns to include rather than a fixed column set.
export function FieldPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (fields: string[]) => void;
}) {
  const { data } = useQuery<{ fields: FieldOption[] }>({
    queryKey: ['reports/employee-fields'],
    queryFn: () => fetch('/api/reports/employee-fields').then((r) => r.json()),
  });
  const all = data?.fields ?? [];
  const available = all.filter((f) => !selected.includes(f.key));
  const selectedFields = selected
    .map((key) => all.find((f) => f.key === key))
    .filter((f): f is FieldOption => !!f);

  const add = (key: string) => onChange([...selected, key]);
  const remove = (key: string) => onChange(selected.filter((k) => k !== key));

  return (
    <div className="flex items-start gap-2">
      <div className="border border-gray-300 rounded-lg p-2 w-52">
        <div className="text-xs font-medium text-gray-600 mb-1.5">Available Fields</div>
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {available.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => add(f.key)}
              className="w-full flex items-center justify-between text-left text-xs text-gray-700 hover:bg-indigo-50 rounded px-1.5 py-1"
            >
              {f.label} <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
            </button>
          ))}
          {available.length === 0 && <div className="text-xs text-gray-400 px-1.5 py-1">All fields added.</div>}
        </div>
      </div>
      <div className="border border-gray-300 rounded-lg p-2 w-52">
        <div className="text-xs font-medium text-gray-600 mb-1.5">Report Fields</div>
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {selectedFields.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => remove(f.key)}
              className="w-full flex items-center justify-between text-left text-xs text-gray-700 hover:bg-red-50 rounded px-1.5 py-1"
            >
              <ChevronLeft className="w-3 h-3 text-gray-400 shrink-0" /> {f.label}
            </button>
          ))}
          {selectedFields.length === 0 && <div className="text-xs text-gray-400 px-1.5 py-1">No fields selected — default columns will be used.</div>}
        </div>
      </div>
    </div>
  );
}
