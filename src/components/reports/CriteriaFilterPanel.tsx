'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
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
  'Units', 'Departments', 'SalaryStructures', 'Designation', 'DayTimeProcedures', 'LeavePolicyGroup', 'HolidayGroup', 'Gender',
]);

// Mirrors legacy's real criteria-picker mechanic (ReportsController::changereporttype/
// addreportcriteria, confirmed via live UI instrumentation): the user doesn't see every filter
// dimension at once. They pick ONE criteria type from a "Criteria" dropdown (e.g. "belonging to a
// Branch"), its value-picker then appears, and a "+" adds another criteria row — with the dropdown
// on each new row excluding whichever criteria are already in use, matching legacy's
// `reportcriteria NOT IN (...)` exclusion.
export function CriteriaFilterPanel({
  reportType,
  values,
  onChange,
}: {
  reportType: string;
  values: Record<string, string[]>;
  onChange: (values: Record<string, string[]>) => void;
}) {
  const { data } = useQuery<{ rows: CriteriaRow[] }>({
    queryKey: ['reports/criteria', reportType],
    queryFn: () => fetch(`/api/reports/criteria?type=${reportType}`).then((r) => r.json()),
  });
  const available = (data?.rows ?? []).filter(
    (c) => c.reportcriteria === 'EmployeeDetails' || OPTION_LIST_CRITERIA.has(c.reportcriteria)
  );

  // Which criteria rows are currently added to the builder. Reset whenever the report type
  // changes (its available criteria set is different) — otherwise a stale row name from a
  // previous report type could linger.
  const [addedNames, setAddedNames] = useState<string[]>([]);
  useEffect(() => { setAddedNames([]); }, [reportType]);

  const unusedOptions = available.filter((c) => !addedNames.includes(c.reportcriteria));

  const addRow = (name: string) => {
    if (!name || addedNames.includes(name)) return;
    setAddedNames([...addedNames, name]);
  };
  const removeRow = (name: string) => {
    setAddedNames(addedNames.filter((n) => n !== name));
    const next = { ...values };
    delete next[name];
    onChange(next);
  };
  const setFor = (name: string, vals: string[]) => onChange({ ...values, [name]: vals });

  return (
    <div className="flex flex-wrap items-end gap-3">
      {addedNames.map((name) => {
        const meta = available.find((c) => c.reportcriteria === name);
        if (!meta) return null;
        return (
          <div key={name} className="relative">
            <button
              type="button"
              onClick={() => removeRow(name)}
              title="Remove criteria"
              className="absolute -top-1 -right-1 z-10 bg-white border border-gray-300 rounded-full p-0.5 text-gray-400 hover:text-red-600"
            >
              <X className="w-3 h-3" />
            </button>
            {name === 'EmployeeDetails' ? (
              <EmployeeChecklist selected={values.EmployeeDetails ?? []} onChange={(vals) => setFor('EmployeeDetails', vals)} />
            ) : (
              <CriteriaOptionSelect
                name={name}
                label={meta.reportcriteria_desc}
                selected={values[name] ?? []}
                onChange={(vals) => setFor(name, vals)}
              />
            )}
          </div>
        );
      })}

      {unusedOptions.length > 0 && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            <Plus className="w-3 h-3 inline" /> Add Criteria
          </label>
          <select
            value=""
            onChange={(e) => addRow(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[180px]"
          >
            <option value="">Choose criteria…</option>
            {unusedOptions.map((c) => (
              <option key={c.reportcriteria} value={c.reportcriteria}>{c.reportcriteria_desc}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function CriteriaOptionSelect({
  name, label, selected, onChange,
}: { name: string; label: string; selected: string[]; onChange: (vals: string[]) => void }) {
  const { data } = useQuery<{ rows: Option[] }>({
    queryKey: ['reports/criteria-options', name],
    queryFn: () => fetch(`/api/reports/criteria-options?criteria=${name}`).then((r) => r.json()),
  });
  const options = data?.rows ?? [];

  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <select
        multiple
        value={selected}
        onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value))}
        className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[160px] h-20"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
