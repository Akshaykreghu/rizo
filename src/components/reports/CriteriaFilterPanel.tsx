'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { EmployeeChecklist } from './EmployeeChecklist';

interface CriteriaRow {
  reportcriteria: string;
  reportcriteria_desc: string;
  reportcriteria_field: string;
}
interface Option {
  value: string | number;
  label: string;
}

// Options-list-backed criteria this app can currently resolve generically via
// GET /api/reports/criteria-options (see src/lib/reports.ts getCriteriaOptions). Anything else
// (e.g. EmployeeProfessionalDetails, a date-range criterion) is silently skipped — not modeled
// yet, matching the project's "ignore what's not wired" pattern rather than rendering broken UI.
const OPTION_LIST_CRITERIA = new Set([
  'Units', 'Departments', 'SalaryStructures', 'Designation', 'DayTimeProcedures', 'LeavePolicyGroup', 'HolidayGroup', 'Gender', 'Banks',
]);

// Criteria selection is exclusive: the user picks exactly ONE criteria type (e.g. "belonging to a
// Branch" vs "belonging to an Employee") from a single dropdown — never both at once. Per explicit
// product decision, this holds for every report type and every criteria pair (not only Employee
// vs Branch), overriding an earlier read of legacy's UI that assumed a "+" could stack multiple
// criteria rows together as combined AND filters.
export function CriteriaFilterPanel({
  reportType,
  values,
  onChange,
  includeResigned,
  onIncludeResignedChange,
  includeNegative,
  onIncludeNegativeChange,
}: {
  reportType: string;
  values: Record<string, string[]>;
  onChange: (values: Record<string, string[]>) => void;
  // Forwarded into whichever criteria dropdown is currently active (EmployeeChecklist or
  // CriteriaOptionSelect) so a report-level "Include Resigned"/"Include Negative Salary" toggle
  // lives inside that dropdown instead of as a separate row — undefined on screens/subtypes that
  // don't have these filters wired at all, in which case neither dropdown renders them.
  includeResigned?: boolean;
  onIncludeResignedChange?: (value: boolean) => void;
  includeNegative?: boolean;
  onIncludeNegativeChange?: (value: boolean) => void;
}) {
  const { data } = useQuery<{ rows: CriteriaRow[] }>({
    queryKey: ['reports/criteria', reportType],
    queryFn: () => fetch(`/api/reports/criteria?type=${reportType}`).then((r) => r.json()),
  });
  const available = (data?.rows ?? []).filter(
    (c) => c.reportcriteria === 'EmployeeDetails' || OPTION_LIST_CRITERIA.has(c.reportcriteria)
  );

  // Which single criteria row is currently active. Reset whenever the report type changes (its
  // available criteria set is different) — otherwise a stale selection from a previous report type
  // could linger. Adjusted during render (React's recommended pattern for resetting state when a
  // prop changes) rather than in an effect, to avoid an extra post-commit render pass.
  const [activeName, setActiveName] = useState<string | null>(null);
  const [prevReportType, setPrevReportType] = useState(reportType);
  if (reportType !== prevReportType) {
    setPrevReportType(reportType);
    setActiveName(null);
  }

  const activeMeta = available.find((c) => c.reportcriteria === activeName);

  const selectCriteria = (name: string) => {
    if (!name) { setActiveName(null); onChange({}); return; }
    setActiveName(name);
    onChange({ [name]: [] });
  };
  const setFor = (name: string, vals: string[]) => onChange({ [name]: vals });

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Criteria</label>
        <select
          value={activeName ?? ''}
          onChange={(e) => selectCriteria(e.target.value)}
          className="h-[42px] border border-[#E5E7EB] bg-white rounded-lg px-3 text-[12.5px] text-[#0F172A] min-w-[160px]"
        >
          <option value="">Choose criteria…</option>
          {available.map((c) => (
            <option key={c.reportcriteria} value={c.reportcriteria}>{c.reportcriteria_desc}</option>
          ))}
        </select>
      </div>

      {activeMeta && (
        activeName === 'EmployeeDetails' ? (
          <EmployeeChecklist
            selected={values.EmployeeDetails ?? []}
            onChange={(vals) => setFor('EmployeeDetails', vals)}
            includeResigned={includeResigned}
            onIncludeResignedChange={onIncludeResignedChange}
            includeNegative={includeNegative}
            onIncludeNegativeChange={onIncludeNegativeChange}
          />
        ) : (
          <CriteriaOptionSelect
            name={activeName!}
            reportType={reportType}
            label={activeMeta.reportcriteria_desc}
            selected={values[activeName!] ?? []}
            onChange={(vals) => setFor(activeName!, vals)}
            includeResigned={includeResigned}
            onIncludeResignedChange={onIncludeResignedChange}
            includeNegative={includeNegative}
            onIncludeNegativeChange={onIncludeNegativeChange}
          />
        )
      )}
    </div>
  );
}

// Checkbox-dropdown multi-select — replaces a native `<select multiple>`, which technically
// supports choosing more than one value (via ctrl/cmd-click) but hides that affordance well
// enough that it reads as single-select. Explicit checkboxes make multi-select unambiguous,
// matching the pattern already established for the Employee criteria (EmployeeChecklist).
function CriteriaOptionSelect({
  name, reportType, label, selected, onChange, includeResigned, onIncludeResignedChange, includeNegative, onIncludeNegativeChange,
}: {
  name: string; reportType: string; label: string; selected: string[]; onChange: (vals: string[]) => void;
  includeResigned?: boolean; onIncludeResignedChange?: (value: boolean) => void;
  includeNegative?: boolean; onIncludeNegativeChange?: (value: boolean) => void;
}) {
  const { data } = useQuery<{ rows: Option[] }>({
    queryKey: ['reports/criteria-options', name, reportType],
    queryFn: () => fetch(`/api/reports/criteria-options?criteria=${name}&reportType=${reportType}`).then((r) => r.json()),
  });
  const options = data?.rows ?? [];
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const filteredOptions = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const summary = selected.length === 0 ? 'Select…' : selected.length === 1
    ? (options.find((o) => String(o.value) === selected[0])?.label ?? `1 selected`)
    : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative">
      <label className="block text-[11.5px] font-medium text-slate-500 mb-1">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-[42px] flex items-center justify-between gap-2 border border-[#E5E7EB] rounded-lg px-3 text-[12.5px] min-w-[160px] bg-white"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="bg-slate-50 border-b border-gray-200 px-3 py-2">
            <div className="text-xs font-semibold text-gray-700 mb-1.5">{label}</div>
            <div className="flex items-center gap-3 text-xs flex-wrap">
              <button type="button" className="text-indigo-600 hover:underline" onClick={() => onChange(options.map((o) => String(o.value)))}>Select all</button>
              <button type="button" className="text-indigo-600 hover:underline" onClick={() => onChange([])}>Deselect all</button>
              {onIncludeResignedChange && (
                <label className="flex items-center gap-1 text-gray-600">
                  <input type="checkbox" checked={!!includeResigned} onChange={(e) => onIncludeResignedChange(e.target.checked)} />
                  Include Resigned
                </label>
              )}
              {onIncludeNegativeChange && (
                <label className="flex items-center gap-1 text-gray-600">
                  <input type="checkbox" checked={!!includeNegative} onChange={(e) => onIncludeNegativeChange(e.target.checked)} />
                  Include Negative Salary
                </label>
              )}
            </div>
          </div>
          <div className="p-2">
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs mb-1"
            />
            <div className="max-h-52 overflow-y-auto">
              {filteredOptions.length === 0 && <div className="px-1 py-2 text-sm text-gray-400">No options</div>}
              {filteredOptions.map((o) => (
                <label key={o.value} className="flex items-center gap-2 px-1 py-1.5 text-sm hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0">
                  <input
                    type="checkbox"
                    checked={selected.includes(String(o.value))}
                    onChange={() => toggle(String(o.value))}
                  />
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
