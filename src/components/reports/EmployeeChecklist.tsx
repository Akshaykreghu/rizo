'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ChevronDown } from 'lucide-react';

interface Option { value: number; label: string }

// Mirrors legacy's "Select Employees" panel confirmed via live instrumentation: Select all /
// Deselect all, a search box, an Include Resigned toggle, one checkbox row per employee
// ("Name - EmpID"). Legacy loads the full matching list (no pagination) since the working set is
// one company's employees — matched here via a 500-row cap, generous for this tenant's real size.
//
// Rendered as a closed-by-default dropdown (button + floating panel), not an always-open inline
// block — the earlier always-open version forced every sibling filter control in the same flex row
// to align to its tall height, which is what produced the large empty space at the top of the
// Payroll Report filter card.
//
// `includeResigned`/`onIncludeResignedChange` are optional: pass them when the parent screen has
// this filter wired up (its value affects the report query itself, e.g. Payroll Summary) so it
// lives inside this dropdown instead of a separate report-level row — this component then just
// reads the parent's value to decide which employees to list. When omitted, this component manages
// that toggle itself (every other report screen using this picker today) and doesn't render
// "Include Negative Salary" at all (that one has no meaningful per-picker default — it's always
// either report-level-wired or absent).
export function EmployeeChecklist({
  selected,
  onChange,
  includeResigned: controlledIncludeResigned,
  onIncludeResignedChange,
  includeNegative,
  onIncludeNegativeChange,
}: {
  selected: string[];
  onChange: (values: string[]) => void;
  includeResigned?: boolean;
  onIncludeResignedChange?: (value: boolean) => void;
  includeNegative?: boolean;
  onIncludeNegativeChange?: (value: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const [internalIncludeResigned, setInternalIncludeResigned] = useState(false);
  const isControlled = controlledIncludeResigned !== undefined;
  const includeResigned = isControlled ? controlledIncludeResigned : internalIncludeResigned;
  const setIncludeResigned = isControlled ? onIncludeResignedChange! : setInternalIncludeResigned;

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

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
    <div ref={ref} className="relative">
      <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employees</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-[42px] flex items-center justify-between gap-2 border border-[#E5E7EB] bg-white rounded-lg px-3 text-[12.5px] text-[#0F172A] min-w-[160px]"
      >
        <span className="flex items-center gap-1.5">
          {selected.length > 0 ? (
            <>
              <span className="inline-flex items-center justify-center rounded-full bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)] text-[10.5px] font-semibold px-1.5 py-0.5 min-w-[18px]">
                {selected.length}
              </span>
              selected
            </>
          ) : (
            <span className="text-slate-400">Select employees</span>
          )}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="bg-slate-50 border-b border-gray-200 px-3 py-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-gray-700">Select Employees</span>
              <span className="text-xs text-gray-400">{selected.length} selected</span>
            </div>
            <div className="flex items-center gap-3 text-xs flex-wrap">
              <button type="button" className="text-indigo-600 hover:underline" onClick={() => onChange(options.map((o) => String(o.value)))}>
                Select all
              </button>
              <button type="button" className="text-indigo-600 hover:underline" onClick={() => onChange([])}>
                Deselect all
              </button>
              <label className="flex items-center gap-1 text-gray-600">
                <input type="checkbox" checked={includeResigned} onChange={(e) => setIncludeResigned(e.target.checked)} />
                Include Resigned
              </label>
              {onIncludeNegativeChange && (
                <label className="flex items-center gap-1 text-gray-600">
                  <input type="checkbox" checked={!!includeNegative} onChange={(e) => onIncludeNegativeChange(e.target.checked)} />
                  Include Negative Salary
                </label>
              )}
            </div>
          </div>
          <div className="p-2">
            <div className="relative mb-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search employees…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full border border-gray-300 rounded pl-7 pr-2 py-1.5 text-xs"
              />
            </div>
            <div className="max-h-52 overflow-y-auto">
              {isLoading && <div className="text-xs text-gray-400 py-2">Loading...</div>}
              {!isLoading && options.length === 0 && <div className="text-xs text-gray-400 py-2">No matches.</div>}
              {options.map((o) => (
                <label key={o.value} className="flex items-center gap-2 px-1 py-1.5 text-sm text-gray-700 cursor-pointer border-b border-gray-50 last:border-0">
                  <input type="checkbox" checked={selected.includes(String(o.value))} onChange={() => toggle(o.value)} />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
