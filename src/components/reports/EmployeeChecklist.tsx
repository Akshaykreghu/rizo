'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

interface Option { value: number; label: string }

// Mirrors legacy's "Select Employees" panel confirmed via live instrumentation: Select all /
// Deselect all, a search box, an Include Resigned toggle, one checkbox row per employee
// ("Name - EmpID"). Legacy loads the full matching list (no pagination) since the working set is
// one company's employees — matched here via a 500-row cap, generous for this tenant's real size.
export function EmployeeChecklist({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [includeResigned, setIncludeResigned] = useState(false);

  const { data, isLoading } = useQuery<{ rows: Option[] }>({
    queryKey: ['reports/employee-options', search, includeResigned],
    queryFn: () =>
      fetch(`/api/reports/employee-options?search=${encodeURIComponent(search)}&includeResigned=${includeResigned ? '1' : '0'}`)
        .then((r) => r.json()),
  });
  const options = data?.rows ?? [];

  const toggle = (value: number) => {
    const v = String(value);
    onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  };

  return (
    <div className="border border-gray-300 rounded-lg p-3 w-64">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-600">Select Employees</span>
        <span className="text-xs text-gray-400">{selected.length} selected</span>
      </div>
      <input
        type="text"
        placeholder="Search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full border border-gray-300 rounded px-2 py-1 text-xs mb-2"
      />
      <div className="flex gap-3 mb-2 text-xs">
        <button type="button" className="text-indigo-600 hover:underline" onClick={() => onChange(options.map((o) => String(o.value)))}>
          Select all
        </button>
        <button type="button" className="text-indigo-600 hover:underline" onClick={() => onChange([])}>
          Deselect all
        </button>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-gray-600 mb-2">
        <input type="checkbox" checked={includeResigned} onChange={(e) => setIncludeResigned(e.target.checked)} />
        Include Resigned
      </label>
      <div className="max-h-40 overflow-y-auto border-t border-gray-100 pt-1 space-y-0.5">
        {isLoading && <div className="text-xs text-gray-400 py-2">Loading...</div>}
        {!isLoading && options.length === 0 && <div className="text-xs text-gray-400 py-2">No matches.</div>}
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-1.5 text-xs text-gray-700 py-0.5 cursor-pointer">
            <input type="checkbox" checked={selected.includes(String(o.value))} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}
